"""Stage 11 - Deployment gate + alert.

Turns the verdict into a gate decision and, on a blocking result, an alert
payload for the responsible person. This stage NEVER deploys anything; it
records a decision and (for GREEN) marks the update as awaiting human approval.
"""

from config import GREEN, RED, YELLOW


def decide(ev):
    reg = ev["regression"]
    meta = ev["meta"]
    verdict = reg["overall"]

    if verdict == GREEN:
        gate = {
            "status": "PASS",
            "action": "AWAITING_HUMAN_APPROVAL",
            "deployable_after_approval": True,
            "message": "Candidate is same-or-better than baseline. Requires human approval before deploy.",
            "next_step": "A human reviewer approves, then the update is deployed and logged.",
        }
    elif verdict == YELLOW:
        gate = {
            "status": "REVIEW",
            "action": "ENGINEER_REVIEW_REQUIRED",
            "deployable_after_approval": False,
            "message": "Non-blocking concerns detected. An engineer must review before deployment.",
            "next_step": "Engineer reviews warnings; either accepts and re-runs, or blocks.",
        }
    else:
        gate = {
            "status": "BLOCK",
            "action": "DEPLOYMENT_BLOCKED",
            "deployable_after_approval": False,
            "message": "Regression detected. Deployment is blocked until resolved and re-validated.",
            "next_step": "Resolve the regression, then re-run validation on a new candidate.",
        }

    alert = None
    if verdict in (RED, YELLOW):
        corr = ev["correlation"]["statements"]
        alert = {
            "severity": ev["impact"]["tier"],
            "verdict": verdict,
            "instrument": meta["instrument"],
            "what_changed": [c["associated_change"] for c in corr][:3]
            or [f"{ev['diff']['summary']['files']} file(s) changed"],
            "what_failed": reg["failed_metrics"] or reg["warn_metrics"],
            "affected_workflows": reg["failed_workflows"] or ev["impact"]["affected_workflows"],
            "v1_vs_v2": [
                {"metric": r["label"], "baseline": r["baseline"], "candidate": r["candidate"]}
                for r in ev["comparison"]["rows"] if r["verdict"] in ("FAIL", "WARN")
            ],
            "deployment_status": gate["action"],
            "responsible_role": "Instrument software owner / lab engineer",
            "channel": "email + dashboard (simulated)",
        }

    return {"gate": gate, "alert": alert}
