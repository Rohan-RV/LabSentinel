"""Top-level workflow orchestrator.

`run_all_workflows` is the single entry point the digital twin calls. It runs
the Measurement, Experiment, and QC workflows on one sample and returns raw
observed metrics. It does NOT decide pass/fail versus a baseline; that is the
job of AI Kavach's deterministic comparison engine.
"""

import random
import time

from instrument import __version__, api, experiment, measurement, qc


def run_all_workflows(sample, trial_seed=0):
    """Execute every workflow for one sample and return observed metrics."""
    rng = random.Random(trial_seed)
    started = time.perf_counter()

    workflows = {}
    errors = 0
    warnings = 0

    # --- Measurement Workflow -------------------------------------------
    try:
        single = measurement.measure(sample, random.Random(trial_seed))
        workflows["Measurement Workflow"] = {
            "completed": True,
            "measurement_value": round(single, 4),
        }
    except Exception as exc:  # pragma: no cover - defensive
        errors += 1
        workflows["Measurement Workflow"] = {"completed": False, "error": str(exc)}

    # --- Experiment Workflow --------------------------------------------
    exp = None
    try:
        exp = experiment.run_experiment(sample, rng)
        workflows["Experiment Workflow"] = {
            "completed": True,
            "measurement_value": exp["measurement_value"],
            "repeatability_pct": exp["repeatability_pct"],
        }
    except Exception as exc:  # pragma: no cover - defensive
        errors += 1
        workflows["Experiment Workflow"] = {"completed": False, "error": str(exc)}

    # --- QC Workflow -----------------------------------------------------
    qc_result = {"status": "not_run"}
    try:
        value = exp["measurement_value"] if exp else 0.0
        qc_result = qc.run_qc(value)
        if qc_result["status"] != "in_range":
            warnings += 1
        workflows["QC Workflow"] = {"completed": True, "status": qc_result["status"]}
    except Exception as exc:  # pragma: no cover - defensive
        errors += 1
        workflows["QC Workflow"] = {"completed": False, "error": str(exc)}

    output = api.format_output(
        sample.get("id", "UNKNOWN"),
        exp or {"measurement_value": 0.0, "repeatability_pct": 0.0},
        qc_result,
        __version__,
    )

    elapsed_ms = (time.perf_counter() - started) * 1000.0

    return {
        "sample_id": sample.get("id", "UNKNOWN"),
        "software_version": __version__,
        "workflows": workflows,
        "output_fields": sorted(output.keys()),
        "error_count": errors,
        "warning_count": warnings,
        "processing_ms": round(elapsed_ms, 4),
    }
