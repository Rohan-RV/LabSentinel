"""Stage 4 - Impact analysis.

Fuses the diff, the AST severity, and the dependency graph into a single
PRE-TEST triage: how much could this change matter, and where should the twin
look hardest? Output is a tier (LOW / MEDIUM / HIGH / CRITICAL) plus the
affected workflows and a transparent rationale.

This is "potentially affected", never "definitely broken". The digital twin
and the deterministic comparison decide what actually regressed.
"""

_SEVERITY_WEIGHT = {
    "none": 0.0,
    "cosmetic": 0.5,
    "non-python": 1.0,
    "logic": 2.0,
    "binary": 2.0,      # weights/firmware changed but unseeable -> must be tested
    "interface": 3.0,
}


def _tier(raw):
    if raw < 3:
        return "LOW"
    if raw < 6:
        return "MEDIUM"
    if raw < 10:
        return "HIGH"
    return "CRITICAL"


def analyze_impact(severity_class, affected_workflows, criticality, arm, structural_changes):
    weight = _SEVERITY_WEIGHT.get(severity_class, 1.0)
    scope = len(affected_workflows)
    raw = weight * (1 + 0.5 * scope) * (criticality / 4.0)
    tier = _tier(raw)

    if arm == "model":
        why = (
            "Model weights changed (binary artifact). Static analysis cannot see "
            "what changed inside the model, so behavioral testing is mandatory. "
            f"{scope} downstream consumer(s) depend on its output."
        )
    else:
        n_sig = sum(1 for c in structural_changes if c["kind"] in
                    ("signature_changed", "function_added", "function_removed"))
        why = (
            f"Change class '{severity_class}'"
            + (f" with {n_sig} interface-level change(s)" if n_sig else "")
            + f", reaching {scope} workflow(s) on a criticality-{criticality} instrument."
        )

    return {
        "tier": tier,
        "score": round(raw, 2),
        "severity_class": severity_class,
        "criticality": criticality,
        "affected_workflows": affected_workflows,
        "rationale": why,
    }
