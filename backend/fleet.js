/**
 * FleetManager - owns live fleet state and the per-tick scoring pipeline:
 *
 *   simulate readings -> XGBoost inference -> envelope guard
 *     -> effective risk -> health score -> EMA smoothing -> classify
 *     -> impact priority -> (on new Critical) memory retrieval + agent
 *     -> persist + emit over Socket.IO
 */
import { classify, config } from "./config.js";
import { FleetSimulator } from "./services/simulator.js";
import { envelopeCheck } from "./services/envelope.js";
import { batchPredict } from "./services/predictionClient.js";
import { computeImpact, PRIORITY_RANK } from "./services/impactEngine.js";
import { getHistory, addRecord } from "./services/memory.js";
import { runAgent } from "./services/agent.js";
import { sendHealthAlert, mailReady } from "./services/mailer.js";
import { recommendParts, placeOrder } from "./services/procurement.js";
import { composeReport } from "./services/report.js";
import { projectRul } from "./services/rul.js";
import { collection, mongoReady } from "./models/db.js";
import { deviceDoc, readingDoc } from "./models/schemas.js";

const EMA_ALPHA = 0.45;         // health smoothing (glide, don't jitter)
const HISTORY_LEN = 120;        // trend points kept per device (~6 min at 3s)
const EVENTS_KEEP = 200;

function pretty(f) {
  return f.replace(/_/g, " ");
}

function buildReason(top_factors = [], breaches = []) {
  const risk = top_factors
    .filter((f) => f.direction === "raises_risk")
    .map((f) => `${pretty(f.feature)} (${f.value})`);
  const env = breaches.map((b) => `${b.label} ${b.value}${b.unit} over ${b.limit}${b.unit} limit`);
  const all = [...env, ...risk];
  return all.length ? `Flagged by ${all.slice(0, 3).join(" + ")}` : "Elevated failure risk";
}

export class FleetManager {
  constructor(io) {
    this.io = io;
    this.sim = new FleetSimulator();
    this.devices = new Map();
    this.events = [];
    this.predictionUp = false;
    this.timer = null;

    for (const inst of this.sim.list()) {
      this.devices.set(inst.id, {
        ...deviceDoc(inst),
        failure_mode: this.sim.deviceTypes[inst.type].failure_mode,
        health: 100,
        rawHealth: 100,
        failure_probability: 0,
        ml_probability: 0,
        envelope_severity: 0,
        status: "Healthy",
        prevStatus: "Healthy",
        confidence: 1,
        sensors_reported: inst.reports.length,
        sensors_expected: inst.reports.length,
        top_factors: [],
        envelope_breaches: [],
        impact: computeImpact({
          failure_probability: 0,
          criticality: inst.criticality,
          active_dependents: inst.active_dependents,
          backup_available: inst.backup_available,
        }),
        lastReading: { timestamp: new Date().toISOString(), readings: {} },
        failing: false,
        ramp_progress: 0,
        history: [],
        agent: null,
        agentedForEpisode: false,
        agentRunning: false,
        emailedLowHealth: false,
        rul: { status: "warming_up" },
        _rulFloor: null,
      });
    }
  }

  async persistDevices() {
    if (!mongoReady()) return;
    const col = collection("devices");
    if (!col) return;
    for (const d of this.devices.values()) {
      await col.updateOne({ id: d.id }, { $set: deviceDoc(d) }, { upsert: true });
    }
  }

  triggerFailure(deviceId) {
    return this.sim.triggerFailure(deviceId);
  }

  async resolveDevice(deviceId) {
    const d = this.devices.get(deviceId);
    if (!d) return false;
    this.sim.clearFailure(deviceId);
    // write a resolution back into maintenance memory (closes the loop)
    if (d.agent) {
      await addRecord({
        deviceId,
        symptom_snapshot: d.lastReading.readings,
        failure_mode: d.failure_mode,
        action_taken: `Corrective maintenance completed for ${d.failure_mode.toLowerCase()}`,
        parts_replaced: [],
        resolution: `Resolved via work order ${d.agent.ticket_id} (${d.agent.technician_assigned})`,
      });
      if (mongoReady()) {
        const col = collection("work_orders");
        if (col) await col.updateOne({ ticket_id: d.agent.ticket_id }, { $set: { status: "RESOLVED" } });
      }
      d.agent = { ...d.agent, status: "RESOLVED" }; // closes the work order in the UI
    }
    d.agentedForEpisode = false;
    return true;
  }

  async orderParts(deviceId) {
    const d = this.devices.get(deviceId);
    if (!d) return null;
    const items =
      (d.agent && d.agent.recommended_parts) ||
      recommendParts({ failure_mode: d.failure_mode, memory: await getHistory(deviceId) });
    const order = await placeOrder(deviceId, items);
    d.partsOrder = order;
    if (mongoReady()) {
      const col = collection("parts_orders");
      if (col) await col.insertOne({ ...order });
    }
    this.io.emit("fleet:update", this.snapshot());
    return order;
  }

  findBackup(device) {
    let best = null;
    for (const d of this.devices.values()) {
      if (d.id === device.id || d.type !== device.type) continue;
      if (d.status === "Healthy") {
        if (!best || d.health > best.health) best = d;
      }
    }
    return best ? best.id : null;
  }

  snapshot() {
    const devices = [...this.devices.values()].map((d) => ({
      id: d.id,
      type: d.type,
      location: d.location,
      criticality: d.criticality,
      reports: d.reports,
      active_dependents: d.active_dependents,
      backup_available: d.backup_available,
      backup_identified: d.backup_identified,
      failure_mode: d.failure_mode,
      health: d.health,
      failure_probability: d.failure_probability,
      status: d.status,
      confidence: d.confidence,
      sensors_reported: d.sensors_reported,
      sensors_expected: d.sensors_expected,
      top_factors: d.top_factors,
      envelope_breaches: d.envelope_breaches,
      impact: d.impact,
      failing: d.failing,
      ramp_progress: d.ramp_progress,
      lastReading: d.lastReading,
      rul: d.rul,
      hasAgent: !!d.agent,
    }));
    return { devices, stats: this.stats(devices), meta: this.meta() };
  }

  stats(devices) {
    const critical = devices.filter((d) => d.status === "Critical").length;
    const warning = devices.filter((d) => d.status === "Warning").length;
    const avg = devices.length
      ? Math.round(devices.reduce((s, d) => s + d.health, 0) / devices.length)
      : 100;
    const maintenance = [...this.devices.values()].filter(
      (d) => d.agent && d.agent.status === "OPEN"
    ).length;
    return {
      active_devices: devices.length,
      critical_alerts: critical,
      warnings: warning,
      maintenance_requests: maintenance,
      fleet_health: avg,
    };
  }

  meta() {
    return {
      prediction_up: this.predictionUp,
      mongo_ready: mongoReady(),
      tick_seconds: config.tickSeconds,
      mail_ready: mailReady(),
    };
  }

  deviceDetail(deviceId) {
    const d = this.devices.get(deviceId);
    if (!d) return null;
    return { ...d };
  }

  _emailPayload(d, now) {
    return {
      id: d.id,
      type: d.type,
      location: d.location,
      health: d.health,
      risk: d.failure_probability,
      status: d.status,
      priority: d.impact.priority,
      reason: buildReason(d.top_factors, d.envelope_breaches),
      rul: d.rul,
      timestamp: now,
    };
  }

  async _sendEmail(d, now) {
    const memory = await getHistory(d.id);
    const report = await composeReport(d, memory);
    await sendHealthAlert({ ...this._emailPayload(d, now), report });
  }

  recentEvents(limit = 50) {
    return [...this.events]
      .sort((a, b) => {
        const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        if (pr !== 0) return pr;
        return b.timestamp.localeCompare(a.timestamp);
      })
      .slice(0, limit);
  }

  // wraps projectRul with a monotonic clamp: within one degradation episode the
  // shown ETA can only count DOWN, never spontaneously increase. Resets when the
  // device stops declining (recovers or goes stable).
  _computeRul(d) {
    const r = projectRul(d.history);
    if (r.status === "declining") {
      if (d._rulFloor != null && r.eta_seconds > d._rulFloor) {
        r.eta_seconds = d._rulFloor;
      } else {
        d._rulFloor = r.eta_seconds;
      }
    } else {
      d._rulFloor = null;
    }
    return r;
  }

  async tick() {
    const readings = this.sim.tickAll();
    let predictions;
    try {
      predictions = await batchPredict(readings.map((r) => r.readings));
      this.predictionUp = true;
    } catch (err) {
      if (this.predictionUp) console.warn(`[fleet] prediction service down: ${err.message}`);
      this.predictionUp = false;
      predictions = readings.map(() => null);
    }

    const now = new Date().toISOString();

    // PASS 1: sensors -> ML risk -> envelope -> health -> status -> history -> RUL.
    for (let i = 0; i < readings.length; i++) {
      const r = readings[i];
      const p = predictions[i];
      const d = this.devices.get(r.device_id);

      const mlProb = p ? p.failure_probability : d.ml_probability;
      const env = envelopeCheck(r.readings);
      const effProb = Math.max(mlProb, env.severity);

      d.ml_probability = Math.round(mlProb * 1000) / 1000;
      d.envelope_severity = env.severity;
      d.envelope_breaches = env.breaches;
      d.failure_probability = Math.round(effProb * 1000) / 1000;
      d.top_factors = p ? p.top_factors : d.top_factors;
      d.confidence = r.confidence;
      d.sensors_reported = r.sensors_reported;
      d.sensors_expected = r.sensors_expected;
      d.lastReading = { timestamp: r.timestamp, readings: r.readings };
      d.failing = r.failing;
      d.ramp_progress = r.ramp_progress;

      d.rawHealth = Math.round((1 - effProb) * 100);
      // EMA smoothing so the % glides instead of jittering
      d.health = Math.round(EMA_ALPHA * d.rawHealth + (1 - EMA_ALPHA) * d.health);

      d.prevStatus = d.status;
      d.status = classify(d.health);

      d.history.push({ t: r.timestamp, health: d.health, probability: d.failure_probability });
      if (d.history.length > HISTORY_LEN) d.history.shift();

      // live estimated time-to-failure from the health trend (projection)
      d.rul = this._computeRul(d);
    }

    const newAlerts = [];
    const agentJobs = [];
    const emailJobs = [];

    // PASS 2: with all statuses settled, resolve live failover, impact, alerts,
    // email and agent. Backup availability is now DYNAMIC and identical
    // everywhere: a healthy same-type unit existing right now.
    for (let i = 0; i < readings.length; i++) {
      const d = this.devices.get(readings[i].device_id);

      const backupId = this.findBackup(d);
      d.backup_available = !!backupId;
      d.backup_identified = backupId;

      d.impact = computeImpact({
        failure_probability: d.failure_probability,
        criticality: d.criticality,
        active_dependents: d.active_dependents,
        backup_available: d.backup_available,
      });

      // proactive email the moment health dips below the alert threshold.
      // edge-triggered with hysteresis so it fires once per degradation.
      if (d.health < config.mail.threshold && !d.emailedLowHealth) {
        d.emailedLowHealth = true;
        emailJobs.push(d);
      } else if (d.health >= config.mail.clear) {
        d.emailedLowHealth = false;
      }

      // alert on crossing into Warning/Critical or escalation to Critical
      const worsened =
        (d.prevStatus === "Healthy" && d.status !== "Healthy") ||
        (d.prevStatus === "Warning" && d.status === "Critical");
      if (worsened) {
        const ev = {
          id: `${d.id}-${Date.now()}`,
          device_id: d.id,
          type: d.type,
          location: d.location,
          timestamp: now,
          status: d.status,
          health: d.health,
          failure_probability: d.failure_probability,
          priority: d.impact.priority,
          impact_score: d.impact.impact_score,
          top_factors: d.top_factors,
          envelope_breaches: d.envelope_breaches,
          reason: buildReason(d.top_factors, d.envelope_breaches),
        };
        this.events.push(ev);
        if (this.events.length > EVENTS_KEEP) this.events.shift();
        newAlerts.push(ev);
        this._persistEvent(ev);
      }

      // recover: allow a fresh agent run on the next episode
      if (d.status === "Healthy") d.agentedForEpisode = false;

      // run the agent once per Critical episode
      if (d.status === "Critical" && !d.agentedForEpisode && !d.agentRunning) {
        d.agentedForEpisode = true;
        agentJobs.push(d);
      }
    }

    this._persistReadings();
    this.io.emit("fleet:update", this.snapshot());
    for (const ev of newAlerts) this.io.emit("alert", ev);

    // fire email alerts (async, don't block the tick)
    for (const d of emailJobs) this._sendEmail(d, now);

    // fire agent jobs (async, don't block the tick)
    for (const d of agentJobs) this._runAgentFor(d);
  }

  async _runAgentFor(d) {
    d.agentRunning = true;
    try {
      const memory = await getHistory(d.id);
      // Only surface a failover unit when this device actually has a designated
      // backup configured. This keeps the Impact box and the agent in sync:
      // no configured backup means the agent never claims one exists.
      const backup = d.backup_identified;
      const ctx = {
        device: {
          id: d.id,
          type: d.type,
          location: d.location,
          criticality: d.criticality,
        },
        failure_probability: d.failure_probability,
        health: d.health,
        status: d.status,
        confidence: d.confidence,
        top_factors: d.top_factors,
        envelope_breaches: d.envelope_breaches,
        impact: d.impact,
        memory,
        failure_mode: d.failure_mode,
        backup_available: d.backup_available,
        backup_identified: backup,
      };
      const result = await runAgent(ctx);
      result.recommended_parts = recommendParts(ctx);
      d.agent = result;
      this.io.emit("agent:update", { device_id: d.id, agent: result, memory });
      // refresh stats (maintenance_requests changed) so header updates promptly
      this.io.emit("fleet:update", this.snapshot());
    } catch (err) {
      console.warn(`[fleet] agent failed for ${d.id}: ${err.message}`);
      d.agentedForEpisode = false;
    } finally {
      d.agentRunning = false;
    }
  }

  async _persistEvent(ev) {
    if (!mongoReady()) return;
    try {
      const col = collection("events");
      if (col) await col.insertOne({ ...ev });
    } catch { /* non-fatal */ }
  }

  async _persistReadings() {
    if (!mongoReady()) return;
    try {
      const col = collection("readings");
      if (!col) return;
      const docs = [...this.devices.values()].map((d) => readingDoc(d));
      if (docs.length) await col.insertMany(docs, { ordered: false });
    } catch { /* non-fatal */ }
  }

  start() {
    if (this.timer) return;
    const run = () => this.tick().catch((e) => console.error("[fleet] tick error", e));
    run();
    this.timer = setInterval(run, config.tickSeconds * 1000);
    console.log(`[fleet] ticking every ${config.tickSeconds}s across ${this.devices.size} devices`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
