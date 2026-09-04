/**
 * One-shot log-file analysis. Unlike the live fleet loop (which ticks forever),
 * this ingests a FINITE log file (EOF-bounded), runs the whole scoring pipeline
 * once over it, and returns a complete diagnosis: device identity, the final
 * state, the health/risk trajectory, explainable factors, operational impact,
 * an agent work-order and an RUL projection. No socket loop, no recurrence.
 *
 * Accepts JSON-lines (the fleet log format), a JSON array, or CSV. Each record
 * may carry a `readings` object or flat feature keys.
 */
import fs from "fs";
import { classify, ROSTER_PATH } from "../config.js";
import { envelopeCheck } from "./envelope.js";
import { batchPredict } from "./predictionClient.js";
import { computeImpact } from "./impactEngine.js";
import { getHistory } from "./memory.js";
import { runAgent } from "./agent.js";
import { projectRul } from "./rul.js";

const FEATURES = [
  "air_temperature",
  "process_temperature",
  "rotational_speed",
  "torque",
  "tool_wear",
];
const EMA_ALPHA = 0.45;

let _roster = null;
function roster() {
  if (!_roster) {
    try {
      _roster = JSON.parse(fs.readFileSync(ROSTER_PATH, "utf-8"));
    } catch {
      _roster = { instances: [], device_types: {} };
    }
  }
  return _roster;
}

function parseContent(content) {
  const text = String(content || "").trim();
  if (!text) return [];
  if (text[0] === "[") {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr : [];
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  // try JSON-lines
  const jsonl = [];
  let ok = true;
  for (const l of lines) {
    try {
      jsonl.push(JSON.parse(l));
    } catch {
      ok = false;
      break;
    }
  }
  if (ok && jsonl.length) return jsonl;
  // fall back to CSV
  const header = lines[0].split(",").map((h) => h.trim());
  const recs = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const obj = {};
    header.forEach((h, j) => {
      obj[h] = cols[j] !== undefined ? cols[j].trim() : undefined;
    });
    recs.push(obj);
  }
  return recs;
}

function toReading(rec) {
  const src = rec && typeof rec.readings === "object" && rec.readings ? rec.readings : rec;
  const out = {};
  for (const f of FEATURES) {
    let v = src ? src[f] : null;
    if (v === "" || v === undefined) v = null;
    else if (v !== null) {
      const n = Number(v);
      v = Number.isFinite(n) ? n : null;
    }
    out[f] = v;
  }
  return out;
}

export async function analyzeLog({ content, filename }) {
  const records = parseContent(content);
  if (!Array.isArray(records) || !records.length) {
    throw new Error("No readings could be parsed from the file (expected JSON-lines, JSON array, or CSV).");
  }
  const readings = records.map(toReading);
  if (readings.every((r) => FEATURES.every((f) => r[f] === null))) {
    throw new Error("File parsed, but no recognised sensor columns were found (air_temperature, process_temperature, rotational_speed, torque, tool_wear).");
  }

  // identity: prefer an id/type in the file, else the filename, else a generic label
  const withId = records.find((r) => r.device_id) || {};
  const rawName = (filename || "").replace(/\.[^.]+$/, "");
  const id = withId.device_id || rawName || "UPLOAD";
  const r = roster();
  const inst = (r.instances || []).find((x) => x.id === id) || null;
  const type = withId.type || inst?.type || "Unknown device";
  const spec = (r.device_types || {})[type] || null;
  const criticality = inst?.criticality ?? 3;
  const active_dependents = inst?.active_dependents ?? 0;
  const backup_available = inst?.backup_available ?? false;
  const location = inst?.location || withId.location || "uploaded log";
  const failure_mode = spec?.failure_mode || "abnormal operating regime";
  const reports = inst?.reports || FEATURES.filter((f) => readings.some((x) => x[f] !== null));

  // real inference over the whole file (single batch)
  let predictions;
  let modelUsed = true;
  try {
    predictions = await batchPredict(readings);
  } catch {
    modelUsed = false;
    predictions = readings.map(() => null);
  }

  const times = records.map(
    (rec, i) => rec.timestamp || new Date(Date.now() - (records.length - i) * 3000).toISOString()
  );

  let health = 100;
  const trajectory = [];
  let final = null;
  let worst = { health: 101 };
  for (let i = 0; i < readings.length; i++) {
    const p = predictions[i];
    const mlProb = p ? p.failure_probability : 0;
    const env = envelopeCheck(readings[i]);
    const eff = Math.max(mlProb, env.severity);
    const raw = Math.round((1 - eff) * 100);
    health = Math.round(EMA_ALPHA * raw + (1 - EMA_ALPHA) * health);
    const prob = Math.round(eff * 1000) / 1000;
    const status = classify(health);
    const point = {
      t: times[i],
      health,
      probability: prob,
      failure_probability: prob,
      status,
      top_factors: p ? p.top_factors : [],
      envelope_breaches: env.breaches,
      readings: readings[i],
    };
    trajectory.push({ t: times[i], health, probability: prob });
    if (health < worst.health) worst = point;
    final = point;
  }

  const impact = computeImpact({
    failure_probability: final.probability,
    criticality,
    active_dependents,
    backup_available,
  });
  const memory = inst ? await getHistory(id) : [];
  const rul = projectRul(trajectory);

  const agent = await runAgent({
    device: { id, type, location, criticality },
    failure_probability: final.probability,
    health: final.health,
    status: final.status,
    confidence: 1,
    top_factors: final.top_factors,
    envelope_breaches: final.envelope_breaches,
    impact,
    memory,
    failure_mode,
    backup_available,
    backup_identified: null,
    persist: false, // one-shot analysis: do not write a live work order
  });

  return {
    source: { filename: filename || null, n_readings: readings.length, model_used: modelUsed },
    device: { id, type, location, criticality, reports, active_dependents, backup_available },
    final: {
      health: final.health,
      status: final.status,
      failure_probability: final.probability,
      top_factors: final.top_factors,
      envelope_breaches: final.envelope_breaches,
      readings: final.readings,
      impact,
    },
    worst: { health: worst.health <= 100 ? worst.health : final.health, status: worst.status || final.status },
    trajectory,
    rul,
    memory,
    agent,
  };
}
