/**
 * Phase 6 - Maintenance Memory. Per-device maintenance history in the
 * `maintenance_history` collection, retrieved on each new Critical event and
 * passed to the Agent so it can cite past incidents. Falls back to an in-memory
 * store when Mongo is unavailable. Seeded with plausible history so the
 * retrieval demo lands (e.g. MRI-02 has two prior cooling-system incidents).
 */
import { collection, mongoReady } from "../models/db.js";

const memStore = new Map(); // deviceId -> [records]  (fallback / mirror)

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}

const SEED = [
  {
    deviceId: "MRI-02",
    timestamp: daysAgo(146),
    symptom_snapshot: { process_temperature: 312.4, air_temperature: 303.1, rotational_speed: 1210 },
    failure_mode: "Heat-dissipation failure (cooling loop)",
    action_taken: "Flushed helium cold-head cooling loop, replaced chiller pump",
    parts_replaced: ["chiller pump", "coolant"],
    resolution: "Resolved - temperature gradient restored to normal",
  },
  {
    deviceId: "MRI-02",
    timestamp: daysAgo(58),
    symptom_snapshot: { process_temperature: 311.8, air_temperature: 302.6, rotational_speed: 1255 },
    failure_mode: "Heat-dissipation failure (cooling loop)",
    action_taken: "Recharged coolant, cleaned condenser fins, firmware recalibration",
    parts_replaced: ["coolant", "condenser filter"],
    resolution: "Resolved - recurring cooling issue; flagged for chiller replacement",
  },
  {
    deviceId: "VENT-03",
    timestamp: daysAgo(89),
    symptom_snapshot: { torque: 71.2, rotational_speed: 2540, process_temperature: 311.0 },
    failure_mode: "Power failure (blower motor drive)",
    action_taken: "Replaced blower motor driver board, re-seated power harness",
    parts_replaced: ["motor driver board"],
    resolution: "Resolved - torque/speed back within range",
  },
  {
    deviceId: "CENT-01",
    timestamp: daysAgo(120),
    symptom_snapshot: { tool_wear: 238, torque: 69.5, rotational_speed: 1400 },
    failure_mode: "Overstrain (rotor bearing wear)",
    action_taken: "Replaced rotor bearing assembly, rebalanced rotor",
    parts_replaced: ["rotor bearing", "drive belt"],
    resolution: "Resolved - vibration and wear returned to baseline",
  },
  {
    deviceId: "HPLC-02",
    timestamp: daysAgo(33),
    symptom_snapshot: { torque: 70.1, rotational_speed: 2510, process_temperature: 310.6 },
    failure_mode: "Power failure (solvent pump)",
    action_taken: "Rebuilt pump head, replaced piston seals",
    parts_replaced: ["piston seals", "check valve"],
    resolution: "Resolved - backpressure normalised",
  },
  {
    deviceId: "PUMP-01",
    timestamp: daysAgo(71),
    symptom_snapshot: { torque: 68.4, rotational_speed: 2495 },
    failure_mode: "Power failure (peristaltic drive)",
    action_taken: "Replaced drive motor and occlusion bearing",
    parts_replaced: ["drive motor", "occlusion bearing"],
    resolution: "Resolved - flow-rate accuracy restored",
  },
];

export async function seedMemory() {
  const col = collection("maintenance_history");
  if (mongoReady() && col) {
    const count = await col.countDocuments();
    if (count === 0) {
      await col.insertMany(SEED.map((r) => ({ ...r, seeded: true })));
      console.log(`[memory] seeded ${SEED.length} maintenance records into Mongo`);
    }
  }
  // always mirror into memory store so getHistory works even without Mongo
  for (const r of SEED) {
    const arr = memStore.get(r.deviceId) || [];
    arr.push({ ...r });
    memStore.set(r.deviceId, arr);
  }
}

export async function getHistory(deviceId, limit = 10) {
  const col = collection("maintenance_history");
  if (mongoReady() && col) {
    return col
      .find({ deviceId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .project({ _id: 0 })
      .toArray();
  }
  const arr = (memStore.get(deviceId) || []).slice().sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );
  return arr.slice(0, limit);
}

export async function addRecord(record) {
  const rec = { ...record, timestamp: record.timestamp || new Date().toISOString() };
  const col = collection("maintenance_history");
  if (mongoReady() && col) await col.insertOne({ ...rec });
  const arr = memStore.get(rec.deviceId) || [];
  arr.push(rec);
  memStore.set(rec.deviceId, arr);
  return rec;
}
