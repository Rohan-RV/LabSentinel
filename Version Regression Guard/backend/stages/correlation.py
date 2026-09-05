"""Stage 8 - Correlation.

Links code/artifact changes to observed regressions THROUGH the dependency
graph. The cardinal rule: we state ASSOCIATION, never proven causation. A
regression in a workflow that depends on a changed component is "associated
with" that component, because we ran a black-box A/B test, not a controlled
ablation of each line.
"""


def correlate(arm, ast_result, graph, regression, impact, changed_files, model_id=None):
    statements = []

    if arm == "model":
        consumers = graph["affected_workflows"]
        for wf in (regression["failed_workflows"] or consumers):
            statements.append({
                "observation": f"Prediction drift observed in outputs consumed by {wf}.",
                "associated_component": model_id or "model artifact",
                "associated_change": "model weights changed (binary artifact; not visible to static analysis)",
                "note": "Association only. The drift co-occurs with the model update; "
                        "static analysis cannot attribute it to any specific code line "
                        "because the change lives in the weights.",
            })
        if not statements:
            statements.append({
                "observation": "No regression observed in the twin.",
                "associated_component": model_id or "model artifact",
                "associated_change": "model weights changed",
                "note": "Candidate stayed within tolerance on the golden sample set.",
            })
        return {"statements": statements}

    # code arm: components with interface/logic changes
    interface_components = sorted({c["file"] for c in ast_result["structural_changes"]})
    changed_components = interface_components or [f for f in changed_files if f.endswith(".py")]

    # map component -> workflows it can reach (via blast radius membership)
    for wf in regression["failed_workflows"]:
        for comp in changed_components:
            if comp in graph["blast_radius"]:
                sig = next((c["detail"] for c in ast_result["structural_changes"]
                            if c["file"] == comp), "modified in candidate")
                statements.append({
                    "observation": f"Regression observed in {wf} "
                                   f"(failed: {', '.join(regression['failed_metrics'])}).",
                    "associated_component": comp,
                    "associated_change": sig,
                    "note": f"{comp} was modified in the candidate and is an upstream "
                            f"dependency of {wf}. Association, not proven causation.",
                })

    if not statements:
        statements.append({
            "observation": "No workflow regression observed in the twin.",
            "associated_component": ", ".join(changed_components) or "n/a",
            "associated_change": "changes did not produce a measurable regression",
            "note": "Potentially-affected workflows were tested and stayed within tolerance.",
        })
    return {"statements": statements}
