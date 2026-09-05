"""Stage 10 - Validation report.

Formats the assembled evidence into the SOFTWARE UPDATE VALIDATION REPORT
(both a plain-text block and structured fields the dashboard renders).
"""

from config import GREEN, RED, YELLOW

_DECISION = {GREEN: "GREEN (PASS)", YELLOW: "YELLOW (REVIEW)", RED: "RED (BLOCKED)"}
_DEPLOY = {GREEN: "AWAITING HUMAN APPROVAL", YELLOW: "ENGINEER REVIEW REQUIRED", RED: "BLOCKED"}


def _trial_counts(ev):
    arm = ev["meta"]["arm"]
    if arm == "model":
        ps = ev["comparison"]["per_sample"]
        passed = sum(1 for p in ps if p["within_tolerance"])
        return passed, len(ps) - passed, len(ps), "samples"
    # code arm: a run passes if its measurement stays within tolerance of baseline mean
    base = ev["comparison"]["baseline_agg"]["measurement_value"]
    tol = ev["rules"]["measurement_value"]["tolerance_pct"]
    passed = total = 0
    for r in ev["twin"]["candidate_runs"]:
        exp = r.get("workflows", {}).get("Experiment Workflow", {})
        if not exp.get("completed"):
            total += 1
            continue
        total += 1
        dev = abs(exp["measurement_value"] - base) / abs(base) * 100 if base else 999
        if dev <= tol:
            passed += 1
    return passed, total - passed, total, "runs"


def _change_counts(ev):
    arm = ev["meta"]["arm"]
    if arm == "model":
        return {"files": ev["diff"]["summary"]["files"], "functions": 0,
                "dependencies": 0, "api_changes": 0, "binary": True}
    sc = ev["ast"]["structural_changes"]
    functions = sum(1 for c in sc if c["kind"] in
                    ("signature_changed", "function_added", "function_removed", "return_changed"))
    deps = sum(1 for c in sc if c["kind"] in ("import_added", "import_removed"))
    api = sum(1 for c in sc if c["kind"] in ("signature_changed", "return_changed"))
    return {"files": ev["diff"]["summary"]["files"], "functions": functions,
            "dependencies": deps, "api_changes": api, "binary": False}


def build_report(ev):
    reg = ev["regression"]
    meta = ev["meta"]
    passed, failed, total, unit = _trial_counts(ev)
    changes = _change_counts(ev)

    corr = ev["correlation"]["statements"]
    assoc_component = corr[0]["associated_component"] if corr else "n/a"
    observed = "; ".join(reg["failed_metrics"]) if reg["failed_metrics"] else (
        "; ".join(reg["warn_metrics"]) if reg["warn_metrics"] else "none")
    affected = ", ".join(reg["failed_workflows"] or ev["impact"]["affected_workflows"]) or "none"

    structured = {
        "instrument": meta["instrument"],
        "instrument_name": meta["instrument_name"],
        "baseline": meta["baseline"],
        "candidate": meta["candidate"],
        "arm": meta["arm"],
        "trials": meta["trials"],
        "code_changes": changes,
        "potential_impact": ev["impact"]["tier"],
        "twin_summary": {"unit": unit, "total": total, "passed": passed, "failed": failed},
        "observed_regression": observed,
        "affected_workflow": affected,
        "associated_component": assoc_component,
        "final_decision": reg["overall"],
        "deployment": _DEPLOY[reg["overall"]],
    }

    lines = [
        "SOFTWARE UPDATE VALIDATION REPORT",
        "=" * 40,
        f"Instrument          : {meta['instrument']} ({meta['instrument_name']})",
        f"Baseline            : {meta['baseline']}",
        f"Candidate           : {meta['candidate']}",
        f"Validation arm      : {meta['arm'].upper()}",
        f"Trials              : {meta['trials']}",
        "",
        "Code / Artifact Changes:",
        f"  Files changed     : {changes['files']}",
    ]
    if changes["binary"]:
        lines.append("  Artifact type     : binary model weights (static analysis blind)")
    else:
        lines += [
            f"  Functions changed : {changes['functions']}",
            f"  Dependency changes: {changes['dependencies']}",
            f"  API changes       : {changes['api_changes']}",
        ]
    lines += [
        "",
        f"Potential Impact    : {ev['impact']['tier']}",
        f"Digital Twin        : {total} {unit} ({meta['trials']} trials)",
        f"  Passed            : {passed}",
        f"  Failed            : {failed}",
        f"Observed Regression : {observed}",
        f"Affected Workflow   : {affected}",
        f"Associated Component: {assoc_component}",
        "",
        f"Final Decision      : {_DECISION[reg['overall']]}",
        f"Deployment          : {_DEPLOY[reg['overall']]}",
    ]
    structured["report_text"] = "\n".join(lines)
    return structured
