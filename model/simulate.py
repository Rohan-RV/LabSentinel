"""Streaming + historical sensor-log simulator for the LabSentinel fleet.

- Emits one reading per device per tick (normal range + gaussian noise), only
  for the sensors each device type actually reports; other features are null.
- Supports a "Simulate Failure" ramp that drives a device toward a real AI4I
  failure regime over ~20-30s so its risk climbs live.
- Pre-generates per-device historical log files (JSON-lines) under data/logs/.
- Attaches a `confidence` = (non-null sensors / expected sensors) to each reading.

This module is the reference simulator. The Node backend mirrors this exact math
so the live demo and the offline logs agree. Training data comes from AI4I 2020,
never from these simulated logs (train once, offline; serve inference forever).
"""
import argparse
import json
import os
import random
import time
from datetime import datetime, timedelta, timezone

from roster import build_instances, load_config

HERE = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(HERE, "data", "logs")

# Per-type failure targets live in config/device_types.json ("failure_targets").
# They were tuned to the model's real failure regions per sensor subset: power
# failure (high torque+speed), heat dissipation (small temp gap + low speed),
# overstrain (high tool wear+torque), or an over-temperature envelope breach for
# temperature-only devices. We ramp the device's reported sensors toward these.

SENSOR_DROPOUT_PROB = 0.03   # chance a reported sensor is momentarily null
WEAR_PER_TICK = 0.8          # tool wear accumulated each normal tick
RAMP_TICKS_DEFAULT = 9       # ~27s at a 3s tick


class DeviceState:
    def __init__(self, inst, types):
        self.inst = inst
        self.spec = types[inst["type"]]
        self.targets = self.spec.get("failure_targets", {})
        self.wear = float(inst["baselines"].get("tool_wear", 0.0))
        self.failing = False
        self.ramp_progress = 0.0     # 0..1
        self.ramp_ticks = RAMP_TICKS_DEFAULT
        self.ramp_step = 0

    def trigger_failure(self, ramp_ticks=RAMP_TICKS_DEFAULT):
        self.failing = True
        self.ramp_ticks = max(1, ramp_ticks)
        self.ramp_step = 0
        self.ramp_progress = 0.0

    def clear_failure(self):
        self.failing = False
        self.ramp_progress = 0.0
        self.ramp_step = 0

    def _base_value(self, feat, params, rng):
        if params.get("accumulates"):
            self.wear += WEAR_PER_TICK + rng.uniform(0, 0.3)
            # preventive tool change well before the safe-envelope limit (240),
            # so normal wear never enters the alarm/risk band on its own
            if self.wear > 180 and not self.failing:
                self.wear = rng.uniform(0, 10)  # tool replaced
            return round(self.wear, 1)
        val = params["mean"] + rng.gauss(0, params["std"])
        if feat == "torque":
            val = max(0.1, val)  # torque never negative
        return round(val, 2)

    def reading(self, rng):
        reports = self.spec["reports"]
        if self.failing:
            self.ramp_step += 1
            self.ramp_progress = min(1.0, self.ramp_step / self.ramp_ticks)

        values = {feat: None for feat in
                  ["air_temperature", "process_temperature", "rotational_speed",
                   "torque", "tool_wear"]}

        for feat in reports:
            params = self.spec["normal"][feat]
            base = self._base_value(feat, params, rng)
            if self.failing and feat in self.targets:
                target = self.targets[feat]
                # ease toward the failure regime; keep a little live noise
                v = base + (target - base) * self.ramp_progress
                if feat == "tool_wear":
                    self.wear = max(self.wear, v)
                    v = self.wear
                v += rng.gauss(0, params["std"] * 0.25)
                values[feat] = round(max(0.1, v) if feat == "torque" else v, 2)
            else:
                values[feat] = base

        # occasional sensor dropout so confidence varies and missing-value
        # handling is exercised end to end
        expected = len(reports)
        for feat in reports:
            if rng.random() < SENSOR_DROPOUT_PROB:
                values[feat] = None
        non_null = sum(1 for feat in reports if values[feat] is not None)
        confidence = round(non_null / expected, 3) if expected else 1.0

        return {
            "device_id": self.inst["id"],
            "type": self.inst["type"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "readings": values,
            "confidence": confidence,
            "sensors_reported": non_null,
            "sensors_expected": expected,
            "failing": self.failing,
        }


class Simulator:
    def __init__(self, seed=None):
        cfg = load_config()
        self.types = cfg["device_types"]
        self.feature_order = cfg["feature_order"]
        self.rng = random.Random(seed)
        self.devices = {inst["id"]: DeviceState(inst, self.types)
                        for inst in build_instances()}

    def trigger_failure(self, device_id, ramp_ticks=RAMP_TICKS_DEFAULT):
        if device_id in self.devices:
            self.devices[device_id].trigger_failure(ramp_ticks)
            return True
        return False

    def tick(self):
        return [dev.reading(self.rng) for dev in self.devices.values()]


def generate_history(rows=200, tick_seconds=3):
    """Write ~`rows` historical readings per device as JSON-lines log files."""
    os.makedirs(LOG_DIR, exist_ok=True)
    cfg = load_config()
    types = cfg["device_types"]
    rng = random.Random(7)
    instances = build_instances()

    for inst in instances:
        state = DeviceState(inst, types)
        state.wear = float(inst["baselines"].get("tool_wear", 0.0))
        start = datetime.now(timezone.utc) - timedelta(seconds=rows * tick_seconds)
        # a minority of devices show a mild drift episode late in their history
        drift = rng.random() < 0.25
        drift_start = rng.randint(int(rows * 0.7), rows - 20) if drift else rows + 1

        path = os.path.join(LOG_DIR, f"{inst['id']}.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for r in range(rows):
                if drift and r == drift_start:
                    state.trigger_failure(ramp_ticks=18)
                if drift and state.failing and state.ramp_step >= 14:
                    state.clear_failure()  # "resolved" - recovers before end
                    state.wear = rng.uniform(0, 10)
                rec = state.reading(rng)
                ts = start + timedelta(seconds=r * tick_seconds)
                rec["timestamp"] = ts.isoformat()
                f.write(json.dumps(rec) + "\n")

    print(f"Wrote historical logs for {len(instances)} devices -> {LOG_DIR}")


def stream(tick_seconds=3, fail=None):
    """Print live readings to stdout (standalone demo / debugging)."""
    sim = Simulator()
    if fail:
        sim.trigger_failure(fail)
        print(f"[simulate] failure ramp triggered on {fail}")
    try:
        while True:
            batch = sim.tick()
            failing = [b for b in batch if b["failing"]]
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {len(batch)} readings"
                  + (f" | ramping: {[b['device_id'] for b in failing]}" if failing else ""))
            time.sleep(tick_seconds)
    except KeyboardInterrupt:
        print("\n[simulate] stopped")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LabSentinel sensor simulator")
    parser.add_argument("--history", action="store_true",
                        help="generate per-device historical log files")
    parser.add_argument("--rows", type=int, default=200)
    parser.add_argument("--stream", action="store_true",
                        help="stream live readings to stdout")
    parser.add_argument("--fail", type=str, default=None,
                        help="device id to ramp toward failure (with --stream)")
    parser.add_argument("--tick", type=int,
                        default=int(os.environ.get("TICK_SECONDS", "3")))
    args = parser.parse_args()

    if args.history:
        generate_history(rows=args.rows, tick_seconds=args.tick)
    elif args.stream:
        stream(tick_seconds=args.tick, fail=args.fail)
    else:
        generate_history(rows=args.rows, tick_seconds=args.tick)
