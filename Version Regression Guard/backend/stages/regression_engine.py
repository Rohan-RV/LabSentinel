"""Stage 7 - Regression engine.

Rolls the comparison rows up into a single traffic-light verdict and a
per-workflow verdict, using a fixed precedence: any FAIL -> RED, else any
WARN -> YELLOW, else GREEN. Deterministic and explainable.
"""

from config import GREEN, RED, YELLOW

_VERDICT_COLOR = {"FAIL": RED, "WARN": YELLOW, "PASS": GREEN}
_RANK = {GREEN: 0, YELLOW: 1, RED: 2}


def evaluate(comparison, affected_workflows):
    rows = comparison["rows"]

    if any(r["verdict"] == "FAIL" for r in rows):
        overall = RED
    elif any(r["verdict"] == "WARN" for r in rows):
        overall = YELLOW
    else:
        overall = GREEN

    per_workflow = {}
    for wf in affected_workflows:
        worst = GREEN
        for r in rows:
            if r.get("workflow") == wf:
                color = _VERDICT_COLOR[r["verdict"]]
                if _RANK[color] > _RANK[worst]:
                    worst = color
        per_workflow[wf] = worst

    failed_metrics = [r["label"] for r in rows if r["verdict"] == "FAIL"]
    warn_metrics = [r["label"] for r in rows if r["verdict"] == "WARN"]
    failed_workflows = [wf for wf, color in per_workflow.items() if color == RED]

    return {
        "overall": overall,
        "per_workflow": per_workflow,
        "failed_metrics": failed_metrics,
        "warn_metrics": warn_metrics,
        "failed_workflows": failed_workflows,
    }
