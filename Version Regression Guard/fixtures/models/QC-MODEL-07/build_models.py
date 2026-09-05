"""Build the mock QC-MODEL-07 fixtures.

Trains three genuinely-different model artifacts so the demo is honest:

  v1        : the validated baseline model.
  v2-drift  : a "vendor update" trained on subtly corrupted calibration
              targets, so its weights really differ and its predictions
              drift a few percent high -> a real regression that git diff
              and AST are BLIND to (it is a binary .pkl), and only the
              digital twin + comparison engine can catch.
  v2-clean  : an honest re-train (different seed, same data) whose
              predictions stay within tolerance -> a safe update (GREEN).

Run once:  python build_models.py
"""

import json
import os

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor

HERE = os.path.dirname(os.path.abspath(__file__))
FEATURES = ["peak_area_1", "peak_area_2", "peak_area_3", "baseline_noise", "temperature"]

# True underlying relationship the instrument's model is meant to learn:
# concentration as a linear function of spectral peak areas.
TRUE_COEF = np.array([2.10, 1.35, 0.80, -0.50, 0.05])
TRUE_INTERCEPT = 4.0


def _make_training_data(n, seed, target_scale=1.0, target_bias=0.0):
    rng = np.random.default_rng(seed)
    X = np.column_stack([
        rng.uniform(5, 25, n),    # peak_area_1
        rng.uniform(2, 18, n),    # peak_area_2
        rng.uniform(0, 12, n),    # peak_area_3
        rng.uniform(0, 3, n),     # baseline_noise
        rng.uniform(20, 30, n),   # temperature
    ])
    y = X @ TRUE_COEF + TRUE_INTERCEPT + rng.normal(0, 0.4, n)
    # target_scale / target_bias inject the "corrupted calibration" for drift.
    y = y * target_scale + target_bias
    return X, y


def _train(seed, n_estimators=45, target_scale=1.0, target_bias=0.0):
    X, y = _make_training_data(700, seed, target_scale, target_bias)
    model = RandomForestRegressor(
        n_estimators=n_estimators, max_depth=8, random_state=seed, n_jobs=1
    )
    model.fit(X, y)
    return model


def _save(model, version, note):
    vdir = os.path.join(HERE, version)
    os.makedirs(vdir, exist_ok=True)
    joblib.dump(model, os.path.join(vdir, "model.pkl"))
    with open(os.path.join(vdir, "meta.json"), "w") as fh:
        json.dump(
            {
                "model_type": type(model).__name__,
                "features": FEATURES,
                "output": "concentration",
                "note": note,
            },
            fh,
            indent=2,
        )


def main():
    # Baseline
    _save(_train(seed=7, n_estimators=45), "v1", "Validated baseline model.")

    # Drifted vendor update: targets scaled +5% and biased -> systematic drift.
    # Genuinely different weights; predictions drift high -> a real regression.
    _save(
        _train(seed=23, n_estimators=45, target_scale=1.05, target_bias=0.6),
        "v2-drift",
        "Vendor update trained on corrupted calibration targets (drifts high).",
    )

    # Safe rebuild: same clean data and seed, a few more trees. Weights really
    # differ (real binary diff) but behavior is unchanged -> should pass GREEN.
    _save(_train(seed=7, n_estimators=60), "v2-clean",
          "Safe rebuild: same data/seed, more trees; behavior unchanged.")

    # Frozen golden sample set (fixed inputs the twin replays through both).
    rng = np.random.default_rng(999)
    samples = []
    for i in range(12):
        vec = [
            round(float(rng.uniform(5, 25)), 3),
            round(float(rng.uniform(2, 18)), 3),
            round(float(rng.uniform(0, 12)), 3),
            round(float(rng.uniform(0, 3)), 3),
            round(float(rng.uniform(20, 30)), 3),
        ]
        samples.append({"id": f"S{i + 1:03d}", "features": dict(zip(FEATURES, vec))})

    with open(os.path.join(HERE, "samples.json"), "w") as fh:
        json.dump({"features": FEATURES, "samples": samples}, fh, indent=2)

    print("Built v1, v2-drift, v2-clean and", len(samples), "golden samples.")


if __name__ == "__main__":
    main()
