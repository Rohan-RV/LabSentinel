/**
 * FleetSimulator - the live tick engine. Ports model/simulate.py's math into
 * Node so the running app mirrors the Python reference simulator exactly:
 * normal readings = per-type mean + gaussian noise (only reported sensors),
 * with a "Simulate Failure" ramp that eases reported sensors toward the
 * per-type failure_targets over ~20-30s. Missing sensors are null.
 */
import fs from "fs";
import { ROSTER_PATH } from "../config.js";

const FEATURES = [
  "air_temperature",
  "process_temperature",
  "rotational_speed",
  "torque",
  "tool_wear",
];

const SENSOR_DROPOUT_PROB = 0.03;
const WEAR_PER_TICK = 0.8;
const RAMP_TICKS_DEFAULT = 9; // ~27s at a 3s tick

function gaussian(mean, std) {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class FleetSimulator {
  constructor() {
    const roster = JSON.parse(fs.readFileSync(ROSTER_PATH, "utf-8"));
    this.deviceTypes = roster.device_types;
    this.featureOrder = roster.feature_order;
    this.instances = roster.instances;
    this.state = new Map();
    for (const inst of this.instances) {
      this.state.set(inst.id, {
        inst,
        spec: this.deviceTypes[inst.type],
        wear: Number(inst.baselines.tool_wear ?? 0),
        failing: false,
        rampTicks: RAMP_TICKS_DEFAULT,
        rampStep: 0,
        rampProgress: 0,
      });
    }
  }

  list() {
    return this.instances;
  }

  triggerFailure(deviceId, rampTicks = RAMP_TICKS_DEFAULT) {
    const s = this.state.get(deviceId);
    if (!s) return false;
    s.failing = true;
    s.rampTicks = Math.max(1, rampTicks);
    s.rampStep = 0;
    s.rampProgress = 0;
    return true;
  }

  clearFailure(deviceId) {
    const s = this.state.get(deviceId);
    if (!s) return false;
    s.failing = false;
    s.rampStep = 0;
    s.rampProgress = 0;
    s.wear = Math.random() * 8;
    return true;
  }

  isFailing(deviceId) {
    return !!this.state.get(deviceId)?.failing;
  }

  _baseValue(s, feat, params) {
    if (params.accumulates) {
      s.wear += WEAR_PER_TICK + Math.random() * 0.3;
      // preventive tool change well before the safe-envelope limit (240)
      if (s.wear > 180 && !s.failing) s.wear = Math.random() * 10;
      return Math.round(s.wear * 10) / 10;
    }
    let val = gaussian(params.mean, params.std);
    if (feat === "torque") val = Math.max(0.1, val);
    return Math.round(val * 100) / 100;
  }

  reading(deviceId) {
    const s = this.state.get(deviceId);
    const reports = s.spec.reports;
    const targets = s.spec.failure_targets || {};

    if (s.failing) {
      s.rampStep += 1;
      s.rampProgress = Math.min(1, s.rampStep / s.rampTicks);
    }

    const values = Object.fromEntries(FEATURES.map((f) => [f, null]));
    for (const feat of reports) {
      const params = s.spec.normal[feat];
      let base = this._baseValue(s, feat, params);
      if (s.failing && targets[feat] !== undefined) {
        const target = targets[feat];
        let v = base + (target - base) * s.rampProgress;
        if (feat === "tool_wear") {
          s.wear = Math.max(s.wear, v);
          v = s.wear;
        }
        v += gaussian(0, params.std * 0.25);
        if (feat === "torque") v = Math.max(0.1, v);
        values[feat] = Math.round(v * 100) / 100;
      } else {
        values[feat] = base;
      }
    }

    // occasional sensor dropout -> confidence < 1, exercises missing handling
    for (const feat of reports) {
      if (Math.random() < SENSOR_DROPOUT_PROB) values[feat] = null;
    }
    const expected = reports.length;
    const nonNull = reports.filter((f) => values[f] !== null).length;

    return {
      device_id: deviceId,
      type: s.inst.type,
      timestamp: new Date().toISOString(),
      readings: values,
      confidence: expected ? Math.round((nonNull / expected) * 1000) / 1000 : 1,
      sensors_reported: nonNull,
      sensors_expected: expected,
      failing: s.failing,
      ramp_progress: Math.round(s.rampProgress * 100) / 100,
    };
  }

  tickAll() {
    return this.instances.map((inst) => this.reading(inst.id));
  }
}

export { FEATURES };
