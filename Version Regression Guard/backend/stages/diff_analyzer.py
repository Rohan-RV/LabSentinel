"""Stage 1 - Source-code diff.

Answers: WHAT changed between the baseline and the candidate version?

Uses real `git diff --no-index` for the per-file unified diff (so this is
genuine git output, not a home-grown text compare), and a tree walk to
classify files as added / modified / removed and text vs binary. Binary
artifacts (a model .pkl, compiled firmware) are flagged as such: git can see
that the bytes changed, but not what the change means. That blindness is the
whole reason the behavioral arm exists.
"""

import os
import subprocess


def _list_files(root):
    found = {}
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if name.endswith((".pyc",)) or "__pycache__" in dirpath:
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            found[rel.replace(os.sep, "/")] = full
    return found


def _is_binary(path):
    try:
        with open(path, "rb") as fh:
            chunk = fh.read(4096)
        chunk.decode("utf-8")
        return False
    except (UnicodeDecodeError, OSError):
        return True


def _numstat(path_a, path_b):
    """Return (added, removed, is_binary) for one file pair via git."""
    try:
        out = subprocess.run(
            ["git", "diff", "--no-index", "--numstat", "--", path_a, path_b],
            capture_output=True, text=True,
        ).stdout.strip()
    except FileNotFoundError:
        return (0, 0, False)
    if not out:
        return (0, 0, False)
    first = out.splitlines()[0].split("\t")
    if first[0] == "-" and first[1] == "-":
        return (0, 0, True)
    try:
        return (int(first[0]), int(first[1]), False)
    except ValueError:
        return (0, 0, False)


def _unified(path_a, path_b):
    try:
        res = subprocess.run(
            ["git", "diff", "--no-index", "--", path_a, path_b],
            capture_output=True, text=True,
        )
        return res.stdout
    except FileNotFoundError:
        return ""


def analyze_diff(baseline_dir, candidate_dir):
    base = _list_files(baseline_dir)
    cand = _list_files(candidate_dir)

    files = []
    insertions = deletions = 0
    binary_changed = False
    diffs = {}

    for rel in sorted(set(base) | set(cand)):
        in_b, in_c = rel in base, rel in cand
        if in_b and in_c:
            with open(base[rel], "rb") as f1, open(cand[rel], "rb") as f2:
                if f1.read() == f2.read():
                    continue  # unchanged
            status = "modified"
            added, removed, is_bin = _numstat(base[rel], cand[rel])
        elif in_c:
            status = "added"
            is_bin = _is_binary(cand[rel])
            added = 0 if is_bin else sum(1 for _ in open(cand[rel], errors="ignore"))
            removed = 0
        else:
            status = "removed"
            is_bin = _is_binary(base[rel])
            removed = 0 if is_bin else sum(1 for _ in open(base[rel], errors="ignore"))
            added = 0

        binary_changed = binary_changed or is_bin
        insertions += added
        deletions += removed
        files.append({
            "path": rel,
            "status": status,
            "added_lines": added,
            "removed_lines": removed,
            "binary": is_bin,
        })
        if not is_bin:
            a = base.get(rel, os.devnull)
            c = cand.get(rel, os.devnull)
            diffs[rel] = _unified(a, c)[:4000]

    return {
        "files_changed": files,
        "summary": {
            "files": len(files),
            "insertions": insertions,
            "deletions": deletions,
            "binary_changed": binary_changed,
        },
        "unified_diffs": diffs,
    }
