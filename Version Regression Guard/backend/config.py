"""Configurable validation rules for AI Kavach.

The whole point of keeping this in one place: different scientific instruments
tolerate different amounts of change. A chromatograph's pressure reading might
allow 0.5% drift; a concentration model might allow 3%. Judges (and real labs)
can tune these without touching pipeline code. Per-scenario overrides live in
fixtures/scenarios.json under each instrument's "rules" key.

Each rule names a comparison strategy the deterministic comparison engine
understands. NOTHING here is decided by an LLM.
"""

# ----------------------------------------------------------------------------
# CODE / FIRMWARE arm: metrics observed by running the instrument software
# through the digital twin, aggregated across trials.
# ----------------------------------------------------------------------------
CODE_RULES = {
    # Calibrated measurement mean must stay close to the baseline.
    "measurement_value": {
        "strategy": "pct_tolerance",
        "tolerance_pct": 0.5,
        "label": "Measurement value",
        "unit": "",
    },
    # Repeatability: higher is better. Candidate may not fall more than
    # abs_drop percentage points below the baseline.
    "repeatability_pct": {
        "strategy": "higher_is_better",
        "abs_drop": 1.0,
        "label": "Repeatability",
        "unit": "%",
    },
    # Processing time: lower is better. Allow up to +30% before we care.
    "processing_ms": {
        "strategy": "lower_is_better",
        "max_ratio": 1.30,
        "label": "Processing time",
        "unit": "ms",
    },
    # Errors and warnings must not increase.
    "error_count": {"strategy": "no_increase", "label": "Error count", "unit": ""},
    "warning_count": {"strategy": "no_increase_warn", "label": "Warning count", "unit": ""},
    # Required output fields must remain present (data-integrity / format).
    "output_fields": {"strategy": "must_stay_superset", "label": "Output fields", "unit": ""},
    # Any workflow that completed on the baseline must still complete.
    "workflow_completion": {"strategy": "must_still_complete", "label": "Workflow completion", "unit": ""},
}

# ----------------------------------------------------------------------------
# MODEL / AI arm: metrics from replaying the golden sample set through both
# model versions. Git diff and AST are BLIND here (weights are a binary blob),
# so this behavioral comparison is the only thing that can catch drift.
# ----------------------------------------------------------------------------
MODEL_RULES = {
    # Each golden sample's prediction must stay within this % of baseline.
    "per_sample_pct_tolerance": 3.0,
    # Fleet-level guards.
    "max_pct_deviation_allowed": 5.0,
    "max_fraction_samples_out": 0.10,
    # Prediction latency: lower is better, allow +50%.
    "latency_max_ratio": 1.50,
}

# Verdict colors used everywhere downstream.
GREEN = "GREEN"
YELLOW = "YELLOW"
RED = "RED"

# How many A/B trials to run by default (the "5-10 trials" from the spec).
DEFAULT_TRIALS = 10


def merge_code_rules(overrides):
    """Return CODE_RULES deep-merged with a scenario's overrides."""
    merged = {k: dict(v) for k, v in CODE_RULES.items()}
    for metric, rule in (overrides or {}).items():
        if metric in merged and isinstance(rule, dict):
            merged[metric].update(rule)
        else:
            merged[metric] = rule
    return merged


def merge_model_rules(overrides):
    merged = dict(MODEL_RULES)
    merged.update(overrides or {})
    return merged
