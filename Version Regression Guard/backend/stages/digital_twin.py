"""Stage 5 - Digital Twin (virtual instrument).

The safe, virtual environment where both versions run against IDENTICAL inputs
before anything touches a real instrument. This is LabSentinel's digital-twin
idea reused for update validation: instead of forecasting wear, it replays the
same samples through V1 and V2 so we can compare behavior.

Two arms:
  * code  - runs the instrument software (isolated subprocess per version).
  * model - replays a frozen golden sample set through each model version.
"""

import json
import os
import subprocess
import sys
import time

import joblib

_RUNNER = os.path.join(os.path.dirname(__file__), "_code_runner.py")


def run_code_twin(version_dir, entry, samples, trials):
    job = json.dumps({
        "version_dir": os.path.abspath(version_dir),
        "entry": entry,
        "samples": samples,
        "trials": trials,
    })
    proc = subprocess.run(
        [sys.executable, _RUNNER],
        input=job, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"twin runner failed: {proc.stderr[-500:]}")
    return json.loads(proc.stdout)["runs"]


def run_model_twin(version_dir, feature_names, samples, trials):
    model = joblib.load(os.path.join(version_dir, "model.pkl"))
    runs = []
    for trial in range(trials):
        for s in samples:
            x = [[s["features"][f] for f in feature_names]]
            t0 = time.perf_counter()
            pred = float(model.predict(x)[0])
            latency = (time.perf_counter() - t0) * 1000.0
            runs.append({
                "sample_id": s["id"],
                "_trial": trial,
                "prediction": round(pred, 6),
                "latency_ms": round(latency, 4),
            })
    return runs


def run_twin(arm, baseline_dir, candidate_dir, scenario, trials):
    if arm == "code":
        entry = scenario["entry"]
        samples = scenario["samples"]
        return {
            "baseline_runs": run_code_twin(baseline_dir, entry, samples, trials),
            "candidate_runs": run_code_twin(candidate_dir, entry, samples, trials),
            "trials": trials,
            "sample_ids": [s["id"] for s in samples],
        }

    # model arm
    sfile = scenario["_samples_abs"]
    data = json.load(open(sfile))
    feats = data["features"]
    samples = data["samples"]
    return {
        "baseline_runs": run_model_twin(baseline_dir, feats, samples, trials),
        "candidate_runs": run_model_twin(candidate_dir, feats, samples, trials),
        "trials": trials,
        "sample_ids": [s["id"] for s in samples],
        "features": feats,
    }
