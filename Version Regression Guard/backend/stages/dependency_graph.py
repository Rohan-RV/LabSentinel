"""Stage 3 - Dependency / call graph and blast radius.

Answers: what else depends on the thing that changed? If CalibrationModule
changed, which workflows reach it? This does NOT claim those workflows broke;
it marks them "potentially affected" so the digital twin knows what to test.

Edges point from a module to the modules it depends on (A imports B => A->B).
The blast radius of a changed module B is therefore every module that can
reach B, i.e. its dependants (networkx ancestors).
"""

import ast
import os

import networkx as nx


def _module_files(package_dir, package_name):
    files = {}
    for name in os.listdir(package_dir):
        if name.endswith(".py"):
            rel = f"{package_name}/{name}"
            mod = f"{package_name}.{name[:-3]}" if name != "__init__.py" else package_name
            files[rel] = mod
    return files


def _imports_of(path, package_name):
    """Return the set of intra-package modules this file imports."""
    try:
        tree = ast.parse(open(path, "r", encoding="utf-8").read())
    except (SyntaxError, OSError):
        return set()
    deps = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if node.module == package_name:
                for alias in node.names:  # from package import submodule
                    deps.add(f"{package_name}.{alias.name}")
            elif node.module.startswith(package_name + "."):
                deps.add(node.module)  # from package.sub import x
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == package_name or alias.name.startswith(package_name + "."):
                    deps.add(alias.name)
    return deps


def build_graph(version_dir, package_name, changed_module_rels, workflow_modules):
    package_dir = os.path.join(version_dir, package_name)
    files = _module_files(package_dir, package_name)      # rel -> module dotted
    mod_to_rel = {mod: rel for rel, mod in files.items()}

    g = nx.DiGraph()
    for rel in files:
        g.add_node(rel)
    for rel, _mod in files.items():
        path = os.path.join(version_dir, rel)
        for dep_mod in _imports_of(path, package_name):
            dep_rel = mod_to_rel.get(dep_mod)
            if dep_rel and dep_rel != rel:
                g.add_edge(rel, dep_rel)  # rel depends on dep_rel

    changed = [r for r in changed_module_rels if r in g]
    blast = set(changed)
    for c in changed:
        blast |= nx.ancestors(g, c)  # everything that depends on the changed module

    affected_workflows = []
    for rel, wf in workflow_modules.items():
        if rel in blast and wf not in affected_workflows:
            affected_workflows.append(wf)

    nodes = [{
        "id": rel,
        "is_changed": rel in changed,
        "is_affected": rel in blast and rel not in changed,
        "workflow": workflow_modules.get(rel),
    } for rel in sorted(files)]
    edges = [{"source": u, "target": v} for u, v in g.edges()]

    return {
        "nodes": nodes,
        "edges": edges,
        "changed_modules": sorted(changed),
        "blast_radius": sorted(blast),
        "affected_workflows": affected_workflows,
    }


def model_graph(model_id, consumers):
    """Trivial 'graph' for the model arm: the model feeds its consumers."""
    nodes = [{"id": model_id, "is_changed": True, "is_affected": False, "workflow": None}]
    edges = []
    for c in consumers:
        nodes.append({"id": c, "is_changed": False, "is_affected": True, "workflow": c})
        edges.append({"source": c, "target": model_id})
    return {
        "nodes": nodes,
        "edges": edges,
        "changed_modules": [model_id],
        "blast_radius": [model_id] + list(consumers),
        "affected_workflows": list(consumers),
    }
