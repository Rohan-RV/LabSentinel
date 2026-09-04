"""Empirically find, per device-type sensor subset, the extreme reported-sensor
values that maximize the model's failure probability (others imputed). Reveals
the real per-type failure target and which subsets can be driven Critical."""
import itertools, os, requests
from roster import load_config

cfg = load_config()
types = cfg["device_types"]
URL = os.environ.get("PREDICT_URL", "http://localhost:8000/predict")

CANDS = {
    "air_temperature": [295.5, 300, 302, 303, 304.2],
    "process_temperature": [306, 309, 311, 312.5, 313.8],
    "rotational_speed": [1170, 1300, 1380, 1500, 2000, 2500, 2850],
    "torque": [3.5, 40, 55, 65, 72, 76],
    "tool_wear": [0, 120, 200, 235, 253],
}

for dtype, spec in types.items():
    reports = spec["reports"]
    grids = [CANDS[f] for f in reports]
    combos = list(itertools.product(*grids))
    readings = [dict(zip(reports, c)) for c in combos]
    preds = requests.post(URL, json={"readings": readings}).json()["predictions"]
    best_i = max(range(len(preds)), key=lambda i: preds[i]["failure_probability"])
    best = preds[best_i]
    vals = readings[best_i]
    verdict = "CRITICAL ok" if best["health_score"] <= 39 else (
        "warning only" if best["health_score"] <= 69 else "CANNOT trigger")
    print(f"{dtype:<20} reports={reports}")
    print(f"   max failure_prob={best['failure_probability']:.3f} "
          f"health={best['health_score']}  [{verdict}]")
    print(f"   at {vals}")
