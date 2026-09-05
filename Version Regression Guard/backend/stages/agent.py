"""Stage 9 - AI Agent (analysis & reporting).

Extends LabSentinel's agent idea to update validation. The agent RECEIVES the
structured evidence (diff, AST, graph, impact, twin, comparison, regression,
correlation) and produces a human-readable explanation and an investigation
list. It narrates; it does not judge.

Hard limits (enforced by construction here):
  * never invents test results or code changes - it only restates evidence;
  * never overrides the deterministic verdict - its recommendation is DERIVED
    from regression['overall'];
  * never approves an unsafe update, modifies source, or deploys.

If LLM_API_KEY is set, the agent asks an LLM to phrase the summary from the
same facts. If not (or on any error), a deterministic template is used, so the
system always runs.
"""

import os

from config import GREEN, RED, YELLOW

_RECOMMENDATION = {GREEN: "PASS (await human approval)", YELLOW: "REVIEW", RED: "BLOCK"}


def _features(arm, ast_result):
    added, modified, removed, deps = [], [], [], []
    if arm == "model":
        modified.append("Model weights updated (binary artifact; no source-level feature diff possible)")
        return added, modified, removed, deps
    for c in ast_result["structural_changes"]:
        if c["kind"] == "function_added":
            added.append(c["detail"])
        elif c["kind"] == "function_removed":
            removed.append(c["detail"])
        elif c["kind"] in ("signature_changed", "return_changed"):
            modified.append(c["detail"])
        elif c["kind"] in ("import_added", "import_removed"):
            deps.append(c["detail"])
    for rel, klass in ast_result.get("file_change_classes", {}).items():
        if klass == "logic" and not any(rel in m for m in modified):
            modified.append(f"{rel}: internal logic changed (interface unchanged)")
    return added, modified, removed, deps


def _deterministic_summary(ev):
    reg = ev["regression"]
    imp = ev["impact"]
    meta = ev["meta"]
    verdict = reg["overall"]
    lines = []
    lines.append(
        f"{meta['instrument']}: candidate {meta['candidate']} vs baseline "
        f"{meta['baseline']} was tested across {meta['trials']} trials in the digital twin."
    )
    lines.append(f"Potential impact was assessed {imp['tier']} ({imp['rationale']})")
    if verdict == RED:
        lines.append(
            "The candidate FAILED deterministic validation. "
            f"Failing checks: {', '.join(reg['failed_metrics'])}."
        )
        if reg["failed_workflows"]:
            lines.append(f"Affected workflow(s): {', '.join(reg['failed_workflows'])}.")
        for s in ev["correlation"]["statements"][:3]:
            lines.append(f"{s['observation']} Associated with {s['associated_component']} "
                         f"({s['associated_change']}). {s['note']}")
        lines.append("Recommendation: BLOCK deployment and investigate before release.")
    elif verdict == YELLOW:
        lines.append(
            "The candidate raised non-blocking concerns: "
            f"{', '.join(reg['warn_metrics'])}. Engineer review recommended before deployment."
        )
    else:
        lines.append(
            "The candidate met all validation criteria (same-or-better than baseline). "
            "It is safe to deploy pending human approval."
        )
    return " ".join(lines)


def _investigation(ev):
    reg = ev["regression"]
    if reg["overall"] == GREEN:
        return ["No action required beyond human sign-off before deployment."]
    items = []
    for s in ev["correlation"]["statements"]:
        if "No " in s["observation"]:
            continue
        items.append(f"Inspect {s['associated_component']} ({s['associated_change']}); "
                     f"it is upstream of the observed regression.")
    for row in ev["comparison"]["rows"]:
        if row["verdict"] == "FAIL":
            items.append(f"Reproduce and root-cause the '{row['label']}' failure: {row['note']}.")
    if not items:
        items.append("Review the flagged warnings and confirm they are acceptable for this instrument.")
    # de-dup, keep order
    seen, out = set(), []
    for i in items:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _try_llm(ev, deterministic_text):
    key = os.environ.get("LLM_API_KEY")
    if not key:
        return deterministic_text, False
    try:  # pragma: no cover - only exercised when a key + SDK are present
        import anthropic

        client = anthropic.Anthropic(api_key=key)
        facts = {
            "meta": ev["meta"], "impact": ev["impact"]["tier"],
            "verdict": ev["regression"]["overall"],
            "failed_metrics": ev["regression"]["failed_metrics"],
            "failed_workflows": ev["regression"]["failed_workflows"],
            "correlation": ev["correlation"]["statements"],
        }
        prompt = (
            "You are a validation reporting assistant. Using ONLY the JSON facts "
            "provided, write a concise, plain-language summary for an engineer. "
            "Do not invent numbers, do not change the verdict, and describe the "
            "code/regression link as an association, not proven causation.\n\n"
            f"FACTS:\n{facts}"
        )
        msg = client.messages.create(
            model=os.environ.get("LLM_MODEL", "claude-3-5-sonnet-latest"),
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip(), True
    except Exception:
        return deterministic_text, False


def analyze(ev):
    arm = ev["meta"]["arm"]
    added, modified, removed, deps = _features(arm, ev["ast"])
    deterministic = _deterministic_summary(ev)
    summary, used_llm = _try_llm(ev, deterministic)

    return {
        "recommendation": _RECOMMENDATION[ev["regression"]["overall"]],
        "features_added": added,
        "features_modified": modified,
        "features_removed": removed,
        "dependency_changes": deps,
        "potentially_affected": ev["impact"]["affected_workflows"],
        "what_failed": ev["regression"]["failed_metrics"],
        "correlation": ev["correlation"]["statements"],
        "why_regression": (
            "The candidate breached at least one deterministic validation rule; "
            "the failing metric(s) exceeded the configured tolerance."
            if ev["regression"]["overall"] == RED else
            "No blocking regression; " + (
                "warnings present." if ev["regression"]["overall"] == YELLOW else "within all tolerances.")
        ),
        "recommended_investigation": _investigation(ev),
        "natural_language_summary": summary,
        "used_llm": used_llm,
    }
