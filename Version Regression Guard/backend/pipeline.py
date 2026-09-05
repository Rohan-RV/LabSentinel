"""AI Kavach - pipeline orchestrator.

Runs the full update-validation flow in order:

  V1 + V2
    -> git diff            (what changed)
    -> tree-sitter / AST   (what it means structurally)
    -> dependency graph    (what depends on it / blast radius)
    -> impact analysis     (what could be affected + severity)
    -> digital twin        (run both versions on identical samples)
    -> comparison engine   (deterministic V1 vs V2)
    -> regression engine   (GREEN / YELLOW / RED)
    -> correlation         (code change <-> observed regression, association)
    -> AI agent            (explain, recommend - does not decide)
    -> report              (validation report)
    -> deployment gate     (+ alert)

The deterministic stages decide; the agent only explains.

Two entry points share ONE implementation (`iter_validation`, a generator that
yields one event per stage):
  * run_validation()  - consumes the generator, returns the final payload.
  * iter_validation()  - used by the SSE endpoint to stream progress live.
"""

import json
import os
import time

import config
from stages import (
    agent, ast_analyzer, comparison_engine, correlation, dependency_graph,
    deployment_gate, diff_analyzer, digital_twin, impact_analysis, regression_engine,
    report as report_stage,
)

FIXTURES = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "fixtures"))


def load_scenarios():
    with open(os.path.join(FIXTURES, "scenarios.json")) as fh:
        return json.load(fh)["instruments"]


def _abs(rel):
    return os.path.join(FIXTURES, rel)


def _twin_table_code(twin):
    rows = []
    for b, c in zip(twin["baseline_runs"], twin["candidate_runs"]):
        be = b.get("workflows", {}).get("Experiment Workflow", {})
        ce = c.get("workflows", {}).get("Experiment Workflow", {})
        rows.append({
            "trial": c.get("_trial"),
            "sample_id": c.get("sample_id"),
            "baseline_value": be.get("measurement_value"),
            "candidate_value": ce.get("measurement_value"),
        })
    return rows


def iter_validation(instrument_id, baseline, candidate, trials=None, pace=0.0):
    """Generator yielding one event per stage.

    Event shape:
      {"stage": id, "label": str, "status": "running"|"done",
       "summary": str, "patch": {...}}   # patch = piece of the final payload
    A final event {"stage": "complete", "payload": {...full...}} carries the
    whole result so the client has a single canonical object to render.

    `pace` inserts a short sleep around each stage so a human can watch the
    pipeline advance. It is purely presentational; the work itself is real.
    Set pace=0 (default) for the batch/CLI path.
    """
    def nap():
        if pace:
            time.sleep(pace)

    instruments = load_scenarios()
    if instrument_id not in instruments:
        raise ValueError(f"unknown instrument {instrument_id}")
    scen = instruments[instrument_id]
    arm = scen["arm"]
    trials = trials or config.DEFAULT_TRIALS

    if baseline not in scen["versions"] or candidate not in scen["versions"]:
        raise ValueError("unknown baseline/candidate version")
    baseline_dir = _abs(scen["versions"][baseline])
    candidate_dir = _abs(scen["versions"][candidate])

    meta = {
        "instrument": instrument_id, "instrument_name": scen["name"], "arm": arm,
        "baseline": baseline, "candidate": candidate, "trials": trials,
    }
    payload = {"meta": meta}
    yield {"stage": "meta", "label": "Inputs", "status": "done",
           "summary": f"{instrument_id}: {baseline} -> {candidate} ({arm} arm, {trials} trials)",
           "patch": {"meta": meta}}

    # 1. diff --------------------------------------------------------------
    yield {"stage": "diff", "label": "Git diff", "status": "running",
           "summary": "diffing source between the two versions..."}
    nap()
    diff = diff_analyzer.analyze_diff(baseline_dir, candidate_dir)
    changed_py = [f["path"] for f in diff["files_changed"] if f["path"].endswith(".py")]
    bin_note = " (incl. binary artifact)" if diff["summary"]["binary_changed"] else ""
    diff_patch = {"diff": {"files_changed": diff["files_changed"], "summary": diff["summary"],
                           "unified_diffs": diff["unified_diffs"]}}
    payload.update(diff_patch)
    yield {"stage": "diff", "label": "Git diff", "status": "done",
           "summary": f"{diff['summary']['files']} file(s) changed{bin_note}: "
                      f"+{diff['summary']['insertions']} / -{diff['summary']['deletions']}",
           "patch": diff_patch}

    # 2. AST ---------------------------------------------------------------
    yield {"stage": "ast", "label": "Tree-sitter / AST", "status": "running",
           "summary": "parsing structure of changed files..."}
    nap()
    ast_res = ast_analyzer.analyze_ast(diff, baseline_dir, candidate_dir)
    if ast_res["structural_changes"]:
        ast_summary = (f"{len(ast_res['structural_changes'])} structural change(s): "
                       f"{ast_res['structural_changes'][0]['detail']}")
    elif any(f["binary"] for f in diff["files_changed"]):
        ast_summary = "binary artifact - no source structure to parse (static analysis is blind here)"
    else:
        ast_summary = "no interface/structure changes detected"
    ast_patch = {"ast": {"structural_changes": ast_res["structural_changes"],
                         "severity_class": ast_res["severity_class"], "notes": ast_res["notes"]}}
    payload.update(ast_patch)
    yield {"stage": "ast", "label": "Tree-sitter / AST", "status": "done",
           "summary": ast_summary, "patch": ast_patch}

    # 3. dependency graph --------------------------------------------------
    yield {"stage": "graph", "label": "Dependency graph", "status": "running",
           "summary": "building call/import graph and blast radius..."}
    nap()
    if arm == "code":
        graph = dependency_graph.build_graph(
            candidate_dir, scen["package"], changed_py, scen["workflow_modules"])
    else:
        graph = dependency_graph.model_graph(instrument_id, scen["consumers"])
    payload["graph"] = graph
    yield {"stage": "graph", "label": "Dependency graph", "status": "done",
           "summary": f"blast radius: {len(graph['affected_workflows'])} workflow(s) potentially "
                      f"affected ({', '.join(graph['affected_workflows']) or 'none'})",
           "patch": {"graph": graph}}

    # 4. impact ------------------------------------------------------------
    yield {"stage": "impact", "label": "Impact analysis", "status": "running",
           "summary": "scoring potential impact..."}
    nap()
    impact = impact_analysis.analyze_impact(
        ast_res["severity_class"], graph["affected_workflows"],
        scen["criticality"], arm, ast_res["structural_changes"])
    payload["impact"] = impact
    yield {"stage": "impact", "label": "Impact analysis", "status": "done",
           "summary": f"{impact['tier']} potential impact (score {impact['score']})",
           "patch": {"impact": impact}}

    # 5. digital twin ------------------------------------------------------
    n_samples = len(scen["samples"]) if arm == "code" else None
    yield {"stage": "twin", "label": "Digital twin", "status": "running",
           "summary": f"spawning sandbox, running baseline {trials} trials..."}
    nap()
    scen_run = dict(scen)
    if arm == "model":
        scen_run["_samples_abs"] = _abs(scen["samples_file"])
    twin = digital_twin.run_twin(arm, baseline_dir, candidate_dir, scen_run, trials)
    n_samples = n_samples or len(twin["sample_ids"])
    payload["twin_table"] = _twin_table_code(twin) if arm == "code" else []
    yield {"stage": "twin", "label": "Digital twin", "status": "done",
           "summary": f"ran V1 and V2 on {n_samples} sample(s) x {trials} trials in the sandbox",
           "patch": {"twin_table": payload["twin_table"]}}

    # 6. comparison --------------------------------------------------------
    yield {"stage": "comparison", "label": "Comparison engine", "status": "running",
           "summary": "comparing V1 vs V2 by deterministic rules..."}
    nap()
    if arm == "code":
        rules = config.merge_code_rules(scen.get("rules"))
        comparison = comparison_engine.compare_code(twin, rules)
    else:
        rules = config.merge_model_rules(scen.get("rules"))
        comparison = comparison_engine.compare_model(twin, rules, scen["consumers"])
    if arm == "model":
        payload["twin_table"] = comparison.get("per_sample", [])
    passes = sum(1 for r in comparison["rows"] if r["verdict"] == "PASS")
    warns = sum(1 for r in comparison["rows"] if r["verdict"] == "WARN")
    fails = sum(1 for r in comparison["rows"] if r["verdict"] == "FAIL")
    payload["comparison"] = comparison
    yield {"stage": "comparison", "label": "Comparison engine", "status": "done",
           "summary": f"{fails} fail / {warns} warn / {passes} pass checks",
           "patch": {"comparison": comparison, "twin_table": payload["twin_table"]}}

    # 7. regression --------------------------------------------------------
    yield {"stage": "regression", "label": "Regression engine", "status": "running",
           "summary": "rolling up to a verdict..."}
    nap()
    regression = regression_engine.evaluate(comparison, graph["affected_workflows"])
    payload["regression"] = regression
    yield {"stage": "regression", "label": "Regression engine", "status": "done",
           "summary": f"verdict: {regression['overall']}",
           "patch": {"regression": regression}}

    ev = {"meta": meta, "diff": diff, "ast": ast_res, "graph": graph, "impact": impact,
          "twin": twin, "comparison": comparison, "rules": rules, "regression": regression}

    # 8. correlation -------------------------------------------------------
    yield {"stage": "correlation", "label": "Correlation", "status": "running",
           "summary": "associating changes with observed behavior..."}
    nap()
    corr = correlation.correlate(
        arm, ast_res, graph, regression, impact, changed_py,
        model_id=instrument_id if arm == "model" else None)
    ev["correlation"] = corr
    payload["correlation"] = corr
    yield {"stage": "correlation", "label": "Correlation", "status": "done",
           "summary": f"{len(corr['statements'])} association(s) (association, not proven cause)",
           "patch": {"correlation": corr}}

    # 9. agent -------------------------------------------------------------
    yield {"stage": "agent", "label": "AI agent", "status": "running",
           "summary": "generating human-readable explanation..."}
    nap()
    agent_out = agent.analyze(ev)
    payload["agent"] = agent_out
    yield {"stage": "agent", "label": "AI agent", "status": "done",
           "summary": f"explanation ready - recommends {agent_out['recommendation']}",
           "patch": {"agent": agent_out}}

    # 10. report -----------------------------------------------------------
    yield {"stage": "report", "label": "Report", "status": "running",
           "summary": "compiling validation report..."}
    nap()
    report = report_stage.build_report(ev)
    payload["report"] = report
    yield {"stage": "report", "label": "Report", "status": "done",
           "summary": "validation report compiled",
           "patch": {"report": report}}

    # 11. gate + alert -----------------------------------------------------
    yield {"stage": "gate", "label": "Deployment gate", "status": "running",
           "summary": "deciding the gate..."}
    nap()
    gate = deployment_gate.decide(ev)
    payload["gate"] = gate["gate"]
    payload["alert"] = gate["alert"]
    yield {"stage": "gate", "label": "Deployment gate", "status": "done",
           "summary": gate["gate"]["action"].replace("_", " ").title(),
           "patch": {"gate": gate["gate"], "alert": gate["alert"]}}

    yield {"stage": "complete", "status": "done", "payload": payload}


def run_validation(instrument_id, baseline, candidate, trials=None):
    last = None
    for ev in iter_validation(instrument_id, baseline, candidate, trials, pace=0.0):
        if ev["stage"] == "complete":
            last = ev["payload"]
    return last


def list_validations():
    out = []
    for iid, scen in load_scenarios().items():
        for v in scen["validations"]:
            out.append({
                "instrument": iid, "instrument_name": scen["name"], "arm": scen["arm"],
                "baseline": v["baseline"], "candidate": v["candidate"],
                "id": v["id"], "title": v["title"],
            })
    return out
