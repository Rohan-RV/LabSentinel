"""Stage 2 - Tree-sitter / AST structural analysis.

Answers: what does the change MEAN structurally? Git diff says "these lines
moved"; tree-sitter tells us a function's signature changed, a parameter was
added, a function appeared or vanished, an import was introduced.

We parse the baseline and candidate versions of each MODIFIED source file with
tree-sitter (language-agnostic parsing; here we load the Python grammar) and
diff the extracted structures. For binary artifacts (model weights, firmware
blobs) there is no source structure to parse: we say so explicitly, because
that is precisely the case static analysis cannot judge.
"""

import tree_sitter_python as tspython
from tree_sitter import Language, Parser

_PY = Language(tspython.language())


def _parser():
    return Parser(_PY)


def _text(node, src):
    return src[node.start_byte:node.end_byte].decode("utf-8", "replace")


def _param_names(params_node, src):
    """Extract parameter identifier names from a `parameters` node."""
    names = []
    if params_node is None:
        return names
    for child in params_node.named_children:
        if child.type == "identifier":
            names.append(_text(child, src))
        elif child.type in (
            "default_parameter", "typed_parameter", "typed_default_parameter",
            "list_splat_pattern", "dictionary_splat_pattern",
        ):
            ident = child.child_by_field_name("name")
            if ident is None:
                # fall back to first identifier descendant
                for c in child.named_children:
                    if c.type == "identifier":
                        ident = c
                        break
            if ident is not None:
                prefix = "*" if child.type == "list_splat_pattern" else (
                    "**" if child.type == "dictionary_splat_pattern" else "")
                names.append(prefix + _text(ident, src))
    return names


def _has_return(func_node):
    stack = list(func_node.children)
    while stack:
        n = stack.pop()
        if n.type == "return_statement":
            return True
        # don't descend into nested function defs
        if n.type in ("function_definition",):
            continue
        stack.extend(n.children)
    return False


def extract_structures(source_bytes):
    tree = _parser().parse(source_bytes)
    root = tree.root_node
    functions, classes, imports = {}, {}, []

    def walk(node, class_ctx=None):
        for child in node.children:
            if child.type == "function_definition":
                name = child.child_by_field_name("name")
                params = child.child_by_field_name("parameters")
                fname = _text(name, source_bytes) if name else "<anon>"
                key = f"{class_ctx}.{fname}" if class_ctx else fname
                functions[key] = {
                    "name": fname,
                    "params": _param_names(params, source_bytes),
                    "has_return": _has_return(child),
                    "class": class_ctx,
                }
                # descend for nested defs but keep same class context off
                walk(child, class_ctx=None)
            elif child.type == "class_definition":
                cname_node = child.child_by_field_name("name")
                cname = _text(cname_node, source_bytes) if cname_node else "<anon>"
                classes.setdefault(cname, [])
                body = child.child_by_field_name("body")
                if body:
                    for m in body.children:
                        if m.type == "function_definition":
                            mn = m.child_by_field_name("name")
                            if mn:
                                classes[cname].append(_text(mn, source_bytes))
                walk(child, class_ctx=cname)
            elif child.type in ("import_statement", "import_from_statement"):
                imports.append(_text(child, source_bytes).strip())
            else:
                walk(child, class_ctx=class_ctx)

    walk(root)
    return {"functions": functions, "classes": classes, "imports": sorted(set(imports))}


def _diff_file(rel, base_bytes, cand_bytes):
    b = extract_structures(base_bytes)
    c = extract_structures(cand_bytes)
    changes = []

    bfn, cfn = b["functions"], c["functions"]
    for name in sorted(set(cfn) - set(bfn)):
        changes.append({"file": rel, "kind": "function_added", "symbol": name,
                        "detail": f"new function {name}({', '.join(cfn[name]['params'])})"})
    for name in sorted(set(bfn) - set(cfn)):
        changes.append({"file": rel, "kind": "function_removed", "symbol": name,
                        "detail": f"function {name} removed"})
    for name in sorted(set(bfn) & set(cfn)):
        bp, cp = bfn[name]["params"], cfn[name]["params"]
        if bp != cp:
            added = [p for p in cp if p not in bp]
            removed = [p for p in bp if p not in cp]
            bits = []
            if added:
                bits.append("parameter(s) added: " + ", ".join(added))
            if removed:
                bits.append("parameter(s) removed: " + ", ".join(removed))
            if not bits:
                bits.append("parameter order changed")
            changes.append({"file": rel, "kind": "signature_changed", "symbol": name,
                            "detail": f"{name}: " + "; ".join(bits),
                            "baseline_params": bp, "candidate_params": cp})
        if bfn[name]["has_return"] != cfn[name]["has_return"]:
            changes.append({"file": rel, "kind": "return_changed", "symbol": name,
                            "detail": f"{name}: return behavior changed"})

    for imp in sorted(set(c["imports"]) - set(b["imports"])):
        changes.append({"file": rel, "kind": "import_added", "symbol": imp, "detail": f"import added: {imp}"})
    for imp in sorted(set(b["imports"]) - set(c["imports"])):
        changes.append({"file": rel, "kind": "import_removed", "symbol": imp, "detail": f"import removed: {imp}"})

    # Classify the change for downstream severity.
    kinds = {ch["kind"] for ch in changes}
    if kinds & {"function_added", "function_removed", "signature_changed", "return_changed",
                "import_added", "import_removed"}:
        change_class = "interface"
    elif base_bytes != cand_bytes:
        change_class = "logic"  # body changed but interface intact
    else:
        change_class = "cosmetic"
    return changes, change_class


def analyze_ast(diff_result, baseline_dir, candidate_dir):
    """Structural diff over every modified/added/removed file."""
    import os

    structural_changes = []
    file_classes = {}
    notes = []

    for f in diff_result["files_changed"]:
        rel = f["path"]
        if f["binary"]:
            file_classes[rel] = "binary"
            notes.append(
                f"{rel}: binary artifact - no source structure to parse. "
                "Structural analysis is blind to this change; only behavioral "
                "testing in the digital twin can judge it."
            )
            continue
        if not rel.endswith(".py"):
            file_classes[rel] = "logic" if f["status"] == "modified" else f["status"]
            notes.append(f"{rel}: non-Python text file ({f['status']}); tracked but not AST-parsed.")
            continue

        base_path = os.path.join(baseline_dir, rel)
        cand_path = os.path.join(candidate_dir, rel)
        base_bytes = open(base_path, "rb").read() if f["status"] != "added" else b""
        cand_bytes = open(cand_path, "rb").read() if f["status"] != "removed" else b""
        changes, change_class = _diff_file(rel, base_bytes, cand_bytes)
        structural_changes.extend(changes)
        file_classes[rel] = change_class

    # Highest-severity change class present drives impact severity later.
    order = {"none": 0, "cosmetic": 1, "logic": 2, "binary": 2, "non-python": 1, "interface": 3}
    top = max((order.get(v, 1) for v in file_classes.values()), default=0)
    severity_class = {0: "none", 1: "cosmetic", 2: "logic", 3: "interface"}[top]
    if "binary" in file_classes.values() and top <= 2:
        severity_class = "binary"

    return {
        "structural_changes": structural_changes,
        "file_change_classes": file_classes,
        "severity_class": severity_class,
        "notes": notes,
    }
