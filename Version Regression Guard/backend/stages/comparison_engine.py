"""Stage 6 - Deterministic comparison engine.

Compares V1 and V2 behavior observed in the twin, strictly by configurable
numeric rules. NO LLM is involved in deciding pass/fail. Each metric produces
a row with a PASS / WARN / FAIL verdict and a note explaining the arithmetic,
so every judgement is auditable.
"""

import statistics


def _verdict_from_pass_warn_fail(ok, warn):
    if not ok:
        return "FAIL"
    return "WARN" if warn else "PASS"


# --------------------------------------------------------------------------
# CODE arm
# --------------------------------------------------------------------------
def _agg_code(runs):
    exp_vals, rep_vals, proc, errs, warns = [], [], [], 0, 0
    completed = {}
    fields = set()
    for r in runs:
        wf = r.get("workflows", {})
        exp = wf.get("Experiment Workflow", {})
        if exp.get("completed") and "measurement_value" in exp:
            exp_vals.append(exp["measurement_value"])
        if exp.get("completed") and "repeatability_pct" in exp:
            rep_vals.append(exp["repeatability_pct"])
        proc.append(r.get("processing_ms", 0.0))
        errs += r.get("error_count", 0)
        warns += r.get("warning_count", 0)
        fields |= set(r.get("output_fields", []))
        for name, info in wf.items():
            completed.setdefault(name, True)
            completed[name] = completed[name] and bool(info.get("completed"))
    return {
        "measurement_value": statistics.fmean(exp_vals) if exp_vals else 0.0,
        "repeatability_pct": statistics.fmean(rep_vals) if rep_vals else 0.0,
        "processing_ms": statistics.fmean(proc) if proc else 0.0,
        "error_count": errs,
        "warning_count": warns,
        "output_fields": fields,
        "completed_workflows": {k for k, v in completed.items() if v},
    }


def compare_code(twin, rules):
    b = _agg_code(twin["baseline_runs"])
    c = _agg_code(twin["candidate_runs"])
    rows = []

    def row(metric, label, unit, base, cand, verdict, note, workflow=None, direction=""):
        rows.append({
            "metric": metric, "label": label, "unit": unit,
            "baseline": base, "candidate": cand, "direction": direction,
            "verdict": verdict, "note": note, "workflow": workflow,
        })

    # measurement_value - accuracy
    r = rules["measurement_value"]
    base, cand = round(b["measurement_value"], 4), round(c["measurement_value"], 4)
    pct = abs(cand - base) / abs(base) * 100 if base else float("inf")
    verdict = "FAIL" if pct > r["tolerance_pct"] else "PASS"
    row("measurement_value", r["label"], r["unit"], base, cand, verdict,
        f"deviation {pct:.2f}% vs tolerance {r['tolerance_pct']}%",
        workflow="Experiment Workflow", direction="closer-to-baseline")

    # repeatability - higher is better
    r = rules["repeatability_pct"]
    base, cand = round(b["repeatability_pct"], 4), round(c["repeatability_pct"], 4)
    drop = base - cand
    verdict = "FAIL" if drop > r["abs_drop"] else ("WARN" if drop > r["abs_drop"] * 0.5 else "PASS")
    row("repeatability_pct", r["label"], r["unit"], base, cand, verdict,
        f"dropped {drop:.3f} pts vs allowed {r['abs_drop']} pts",
        workflow="Experiment Workflow", direction="higher-better")

    # processing time - lower is better (perf regression is a WARN, not a block)
    r = rules["processing_ms"]
    base, cand = round(b["processing_ms"], 4), round(c["processing_ms"], 4)
    ratio = cand / base if base else 1.0
    if ratio > r["max_ratio"]:
        verdict, note = "WARN", f"slower: {ratio:.2f}x baseline (allowed {r['max_ratio']}x)"
    elif ratio < 1.0:
        verdict, note = "PASS", f"improved: {ratio:.2f}x baseline"
    else:
        verdict, note = "PASS", f"{ratio:.2f}x baseline"
    row("processing_ms", r["label"], r["unit"], base, cand, verdict, note, direction="lower-better")

    # error count - must not increase
    row("error_count", rules["error_count"]["label"], "", b["error_count"], c["error_count"],
        "FAIL" if c["error_count"] > b["error_count"] else "PASS",
        "errors must not increase", direction="lower-better")

    # warning count - must not increase (QC out-of-range surfaces here)
    row("warning_count", rules["warning_count"]["label"], "", b["warning_count"], c["warning_count"],
        "WARN" if c["warning_count"] > b["warning_count"] else "PASS",
        "warnings rose (QC control / range)" if c["warning_count"] > b["warning_count"]
        else "no new warnings", workflow="QC Workflow", direction="lower-better")

    # output fields - data integrity / format contract
    missing = sorted(b["output_fields"] - c["output_fields"])
    row("output_fields", rules["output_fields"]["label"], "", len(b["output_fields"]),
        len(c["output_fields"]), "FAIL" if missing else "PASS",
        f"missing required field(s): {', '.join(missing)}" if missing
        else "all required output fields present")

    # workflow completion
    lost = sorted(b["completed_workflows"] - c["completed_workflows"])
    row("workflow_completion", rules["workflow_completion"]["label"], "",
        len(b["completed_workflows"]), len(c["completed_workflows"]),
        "FAIL" if lost else "PASS",
        f"workflow(s) no longer complete: {', '.join(lost)}" if lost
        else "all baseline workflows still complete")

    return {"rows": rows, "baseline_agg": _jsonable(b), "candidate_agg": _jsonable(c)}


def _jsonable(agg):
    out = dict(agg)
    out["output_fields"] = sorted(agg["output_fields"])
    out["completed_workflows"] = sorted(agg["completed_workflows"])
    return out


# --------------------------------------------------------------------------
# MODEL arm
# --------------------------------------------------------------------------
def _mean_by_sample(runs):
    acc, lat = {}, {}
    for r in runs:
        acc.setdefault(r["sample_id"], []).append(r["prediction"])
        lat.setdefault(r["sample_id"], []).append(r["latency_ms"])
    preds = {sid: statistics.fmean(v) for sid, v in acc.items()}
    latency = statistics.fmean([x for v in lat.values() for x in v]) if lat else 0.0
    return preds, latency


def compare_model(twin, rules, consumers):
    bpred, blat = _mean_by_sample(twin["baseline_runs"])
    cpred, clat = _mean_by_sample(twin["candidate_runs"])

    per_sample = []
    devs = []
    for sid in twin["sample_ids"]:
        base, cand = bpred[sid], cpred[sid]
        pct = abs(cand - base) / abs(base) * 100 if base else float("inf")
        devs.append(pct)
        per_sample.append({
            "sample_id": sid,
            "baseline": round(base, 4),
            "candidate": round(cand, 4),
            "pct_deviation": round(pct, 3),
            "within_tolerance": pct <= rules["per_sample_pct_tolerance"],
        })

    mean_dev = statistics.fmean(devs) if devs else 0.0
    max_dev = max(devs) if devs else 0.0
    frac_out = sum(1 for d in devs if d > rules["per_sample_pct_tolerance"]) / len(devs) if devs else 0.0
    wf = consumers[0] if consumers else None

    rows = []

    def row(metric, label, unit, base, cand, verdict, note, workflow=None, direction=""):
        rows.append({"metric": metric, "label": label, "unit": unit, "baseline": base,
                     "candidate": cand, "verdict": verdict, "note": note,
                     "workflow": workflow, "direction": direction})

    row("samples_out_of_tolerance", "Samples out of tolerance", "%",
        0.0, round(frac_out * 100, 1),
        "FAIL" if frac_out > rules["max_fraction_samples_out"] else "PASS",
        f"{frac_out * 100:.0f}% of samples drifted > {rules['per_sample_pct_tolerance']}% "
        f"(allowed {rules['max_fraction_samples_out'] * 100:.0f}%)",
        workflow=wf, direction="lower-better")

    v = "FAIL" if max_dev > rules["max_pct_deviation_allowed"] else (
        "WARN" if max_dev > rules["per_sample_pct_tolerance"] else "PASS")
    row("max_prediction_deviation", "Max prediction deviation", "%", 0.0, round(max_dev, 2), v,
        f"worst-case drift {max_dev:.2f}% vs allowed {rules['max_pct_deviation_allowed']}%",
        workflow=wf, direction="lower-better")

    v = "WARN" if mean_dev > rules["per_sample_pct_tolerance"] else "PASS"
    row("mean_prediction_deviation", "Mean prediction deviation", "%", 0.0, round(mean_dev, 2), v,
        f"average drift {mean_dev:.2f}% (per-sample tolerance {rules['per_sample_pct_tolerance']}%)",
        workflow=wf, direction="lower-better")

    ratio = clat / blat if blat else 1.0
    row("prediction_latency", "Prediction latency", "ms", round(blat, 4), round(clat, 4),
        "WARN" if ratio > rules["latency_max_ratio"] else "PASS",
        f"{ratio:.2f}x baseline latency", direction="lower-better")

    return {"rows": rows, "per_sample": per_sample,
            "aggregates": {"mean_pct_deviation": round(mean_dev, 3),
                           "max_pct_deviation": round(max_dev, 3),
                           "fraction_out_of_tolerance": round(frac_out, 3)}}
