"""Sanity check: normal subset readings score healthy; failure ramps score critical."""
import json, os, requests
from roster import build_instances, load_config

cfg = load_config()
types = cfg["device_types"]
FAIL = {"air_temperature": 303.5, "process_temperature": 313.5,
        "rotational_speed": 1240.0, "torque": 67.0, "tool_wear": 246.0}
URL = os.environ.get("PREDICT_URL", "http://localhost:8000/predict")

seen = {}
for inst in build_instances():
    if inst["type"] in seen:
        continue
    seen[inst["type"]] = inst

normal_readings, fail_readings, order = [], [], []
for dtype, inst in seen.items():
    spec = types[dtype]
    normal = {f: inst["baselines"].get(f, spec["normal"][f]["mean"]) for f in spec["reports"]}
    failing = {f: FAIL[f] for f in spec["reports"]}
    normal_readings.append(normal)
    fail_readings.append(failing)
    order.append(dtype)

n = requests.post(URL, json={"readings": normal_readings}).json()["predictions"]
fl = requests.post(URL, json={"readings": fail_readings}).json()["predictions"]

print(f"{'device type':<20}{'reports':<4}{'normal health':>14}{'failure health':>16}")
print("-" * 54)
ok = True
for dtype, np_, fp_ in zip(order, n, fl):
    nrep = len(types[dtype]["reports"])
    print(f"{dtype:<20}{nrep:<4}{np_['health_score']:>14}{fp_['health_score']:>16}")
    if np_["health_score"] < 70:
        ok = False; print(f"   !! {dtype} normal reading not Healthy")
    if fp_["health_score"] > 39:
        ok = False; print(f"   !! {dtype} failure reading not Critical")
print("\nALL PASS" if ok else "\nSOME CHECKS FAILED")
