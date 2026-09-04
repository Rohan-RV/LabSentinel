/**
 * Phase 7 - Autonomous Agent. Runs AFTER prediction + Impact + Memory. Turns the
 * full context into a structured diagnosis + recommended action + simulated
 * work-order, plus a plain-language summary.
 *
 * Uses the Anthropic LLM when LLM_API_KEY is set; otherwise falls back to a
 * deterministic rule-based explanation so the app never breaks. Actions are
 * SIMULATED - the ticket/assignment are written to Mongo and shown in the UI;
 * no real external ticketing system is touched.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { collection, mongoReady } from "../models/db.js";

let ticketSeq = 1040;
function nextTicketId() {
  ticketSeq += 1;
  return `MT-${ticketSeq}`;
}

const TECHS = {
  "Heat-dissipation": ["Priya Nair (HVAC/Cooling)", "Marcus Webb (Cryogenics)"],
  Power: ["Diego Alvarez (Electrical/Drives)", "Sara Kim (Power Systems)"],
  Overstrain: ["Tom Fletcher (Mechanical)", "Aisha Rahman (Rotating Equipment)"],
  "over-temperature": ["Lena Ortiz (Thermal Systems)", "Raj Patel (Bio-med)"],
  default: ["Jordan Lee (Biomedical Engineering)", "Sam Rivera (Field Service)"],
};

function pickTech(failureMode = "") {
  for (const key of Object.keys(TECHS)) {
    if (key !== "default" && failureMode.toLowerCase().includes(key.toLowerCase())) {
      const list = TECHS[key];
      return list[Math.floor(Math.random() * list.length)];
    }
  }
  const list = TECHS.default;
  return list[Math.floor(Math.random() * list.length)];
}

function factorPhrase(top_factors = [], breaches = []) {
  const risk = top_factors.filter((f) => f.direction === "raises_risk").map((f) => f.feature);
  const parts = [];
  if (risk.length) parts.push(risk.map(pretty).join(" + "));
  if (breaches.length) parts.push(breaches.map((b) => `${b.label} ${b.value}${b.unit}`).join(" + "));
  return parts.join("; also ") || "abnormal sensor pattern";
}

function pretty(feat) {
  return feat.replace(/_/g, " ");
}

function buildFallback(ctx) {
  const {
    device,
    failure_probability,
    health,
    top_factors = [],
    envelope_breaches = [],
    impact,
    memory = [],
    failure_mode,
    backup_available = false,
    backup_identified,
  } = ctx;

  const pct = Math.round(failure_probability * 100);
  const drivers = factorPhrase(top_factors, envelope_breaches);
  const mode = failure_mode || "abnormal operating regime";

  let memoryClause = "No prior incidents on record for this device.";
  let recommended = `Dispatch a technician to inspect ${device.id} for ${mode.toLowerCase()}.`;
  if (memory.length) {
    const like = memory[0];
    const times = memory.length;
    memoryClause =
      `Similar pattern resolved ${times === 1 ? "once" : times + " times"} before ` +
      `via ${like.action_taken.toLowerCase()}` +
      (like.parts_replaced?.length ? ` (parts: ${like.parts_replaced.join(", ")})` : "") + ".";
    recommended =
      `Apply the previously successful fix: ${like.action_taken}. ` +
      `Pre-stage parts: ${(like.parts_replaced || []).join(", ") || "per manual"}.`;
  }

  const impactClause =
    `Operational impact: ${impact.priority} ` +
    `(criticality ${impact.factors.criticality}/5, ${impact.factors.active_dependents} dependent(s)).`;

  const summary =
    `${device.id} (${device.type}, ${device.location}) at ${pct}% failure risk - health ${health}%. ` +
    `Flagged by ${drivers}. ${impactClause} ${memoryClause}`;

  return {
    diagnosis: `${mode}. Predicted failure probability ${pct}%. Primary drivers: ${drivers}.`,
    recommended_action: recommended,
    backup_identified: backup_identified || null,
    natural_language_summary: summary,
  };
}

async function callLLM(ctx) {
  const client = new Anthropic({ apiKey: config.llmApiKey });
  const system =
    "You are LabSentinel's maintenance agent for a fleet of hospital and lab " +
    "instruments. Given a device's live risk, the driving sensor factors, its " +
    "operational impact, and its past maintenance history, produce a concise, " +
    "actionable diagnosis. Respond with ONLY a JSON object with keys: " +
    "diagnosis, recommended_action, backup_identified, natural_language_summary. " +
    "Cite past incidents when relevant. Do NOT mention backup or standby units in any field " +
    "(failover is tracked live outside your response); set backup_identified to null. " +
    "Keep natural_language_summary to 2-3 sentences.";

  const msg = await client.messages.create({
    model: config.llmModel,
    max_tokens: 600,
    system,
    messages: [{ role: "user", content: JSON.stringify(ctx) }],
  });

  const text = (msg.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("LLM returned no JSON");
  return JSON.parse(match[0]);
}

export async function runAgent(ctx) {
  const failure_mode = ctx.failure_mode;
  let core;
  let mode = "rule-based";
  if (config.llmApiKey) {
    try {
      core = await callLLM(ctx);
      mode = "llm";
    } catch (err) {
      console.warn(`[agent] LLM call failed (${err.message}); using rule-based fallback`);
      core = buildFallback(ctx);
    }
  } else {
    core = buildFallback(ctx);
  }

  const result = {
    device_id: ctx.device.id,
    ticket_id: nextTicketId(),
    technician_assigned: pickTech(failure_mode),
    diagnosis: core.diagnosis,
    recommended_action: core.recommended_action,
    backup_identified: ctx.backup_identified ?? null,
    natural_language_summary: core.natural_language_summary,
    priority: ctx.impact.priority,
    mode,
    created_at: new Date().toISOString(),
    status: "OPEN",
  };

  if (ctx.persist !== false && mongoReady()) {
    const col = collection("work_orders");
    if (col) await col.insertOne({ ...result });
  }
  return result;
}
