/**
 * Per-device DIGITAL TWIN forward simulation.
 *
 * A data-driven behavioural twin: it starts from the device's CURRENT state and
 * projects its sensors forward under scenario knobs (load factor, ambient temp
 * offset), scoring every projected step with the SAME XGBoost model + envelope
 * guard the live app uses. This is not first-principles physics; it is the
 * device-type's empirical degradation model run ahead and scored, so the "what
 * if" answers are grounded in the real model, not a lookup table.
 *
 *   - load_factor  > 1 pushes stress sensors (torque/speed/wear) toward the
 *     type's failure regime faster; <= 1 lets a healthy device coast.
 *   - ambient_offset shifts air/process temperature (can trip the envelope).
 *   - a device already degrading keeps degrading (momentum from its current
 *     position along the failure path), even at nominal load.
 */
import { envelopeCheck } from "./envelope.js";
import { batchPredict } from "./predictionClient.js";
import { classify, config } from "../config.js";

const FEATURES = [
  "air_temperature",
  "process_temperature",
  "rotational_speed",
  "torque",
  "tool_wear",
];

const BASE_LOAD_RATE = 0.05; // degradation progress per step per unit of overload
const BASE_SELF_RATE = 0.045; // momentum when the device is already degraded
const WEAR_RATE = 1.6; // tool-wear accrued per step at nominal load
const EMA_ALPHA = 0.45;

export async function simulateTwin(fleet, id, opts = {}) {
  const steps = opts.steps ?? 40;
  const load_factor = opts.load_factor ?? 1.0;
  const ambient_offset = opts.ambient_offset ?? 0;

  const d = fleet.devices.get(id);
  if (!d) throw new Error("device not found");
  const spec = fleet.sim.deviceTypes[d.type] || null;
  const reports = d.reports || [];
  const targets = (spec && spec.failure_targets) || {};

  const normal = {};
  for (const f of reports) {
    normal[f] = spec?.normal?.[f]?.mean ?? d.lastReading?.readings?.[f] ?? 0;
  }
  const current = {};
  for (const f of reports) {
    const v = d.lastReading?.readings?.[f];
    current[f] = v === null || v === undefined ? normal[f] : v;
  }

  // estimate current degradation fraction (0..1) as the worst sensor's position
  // between its normal mean and its failure target
  const fracs = [];
  for (const f of reports) {
    const t = targets[f];
    if (t === undefined) continue;
    const denom = t - normal[f];
    if (Math.abs(denom) < 1e-6) continue;
    fracs.push(Math.max(0, Math.min(1, (current[f] - normal[f]) / denom)));
  }
  const p0 = fracs.length ? Math.max(...fracs) : 0;

  const tick = config.tickSeconds || 3;
  const loadStress = Math.max(0, load_factor - 1);

  const projReadings = [];
  let wear = current.tool_wear ?? normal.tool_wear ?? 0;
  for (let s = 1; s <= steps; s++) {
    const p = Math.min(1, p0 + (BASE_SELF_RATE * p0 + BASE_LOAD_RATE * loadStress) * s);
    const reading = Object.fromEntries(FEATURES.map((f) => [f, null]));
    for (const f of reports) {
      if (f === "tool_wear") {
        wear += WEAR_RATE * load_factor;
        if (targets[f] !== undefined) {
          wear = Math.max(wear, normal[f] + (targets[f] - normal[f]) * p);
        }
        reading[f] = Math.round(wear * 10) / 10;
      } else {
        let base = normal[f];
        if (targets[f] !== undefined) base = normal[f] + (targets[f] - normal[f]) * p;
        if (f === "air_temperature" || f === "process_temperature") base += ambient_offset;
        reading[f] = Math.round(base * 100) / 100;
      }
    }
    projReadings.push(reading);
  }

  let modelUsed = true;
  let preds;
  try {
    preds = await batchPredict(projReadings);
  } catch {
    modelUsed = false;
    preds = projReadings.map(() => null);
  }

  const projection = [];
  let ttc = null;
  let health = d.health;
  for (let i = 0; i < projReadings.length; i++) {
    const p = preds[i];
    const ml = p ? p.failure_probability : 0;
    const env = envelopeCheck(projReadings[i]);
    const eff = Math.max(ml, env.severity);
    const raw = Math.round((1 - eff) * 100);
    health = Math.round(EMA_ALPHA * raw + (1 - EMA_ALPHA) * health);
    const status = classify(health);
    if (ttc === null && status === "Critical") ttc = (i + 1) * tick;
    projection.push({
      t: (i + 1) * tick,
      readings: projReadings[i],
      risk: Math.round(eff * 1000) / 1000,
      health,
      status,
    });
  }

  return {
    device: { id: d.id, type: d.type, location: d.location, reports },
    scenario: { steps, load_factor, ambient_offset, tick_seconds: tick },
    expected_normal: normal,
    current,
    projection,
    time_to_critical_sec: ttc,
    model_used: modelUsed,
  };
}
