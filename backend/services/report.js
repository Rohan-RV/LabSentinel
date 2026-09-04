/**
 * Diagnostic report composer. Produces a full PDF maintenance report for a
 * device: summary, diagnosis (what), root cause (why), workflow impact, RUL,
 * fix steps with parts, prevention, past incidents, and the device's REAL
 * health/failure-risk trend chart drawn from its live history.
 *
 * Narrative text is rule-based by default (no LLM, no tokens). If GROQ_API_KEY
 * is set it is written by Groq instead (the user's Groq account), with the
 * rule-based text as a safe fallback on any error.
 */
import PDFDocument from "pdfkit";
import { config } from "../config.js";
import { recommendParts } from "./procurement.js";

const pretty = (f) => String(f).replace(/_/g, " ");

function drivers(d) {
  const risk = (d.top_factors || [])
    .filter((f) => f.direction === "raises_risk")
    .map((f) => `${pretty(f.feature)} (${f.value})`);
  const env = (d.envelope_breaches || []).map(
    (b) => `${b.label} ${b.value}${b.unit} over the ${b.limit}${b.unit} limit`
  );
  const all = [...env, ...risk];
  return all.length ? all.join(", ") : "an abnormal overall pattern";
}

function modeKey(fm = "") {
  fm = fm.toLowerCase();
  if (fm.includes("heat-dissipation") || fm.includes("cooling")) return "heat";
  if (fm.includes("overstrain")) return "overstrain";
  if (fm.includes("thermal block")) return "thermal";
  if (fm.includes("power")) return "power";
  if (fm.includes("temperature")) return "temp";
  return "default";
}

const ROOT = {
  heat: "The cooling path is not shedding heat fast enough. The air and process temperatures are converging while speed drops, which points to a failing chiller pump or a blocked condenser.",
  power: "Torque and rotational speed have moved outside the safe band, which points to a strained or failing drive motor or its driver board.",
  overstrain: "High tool wear together with rising torque indicates mechanical overstrain, usually a worn rotor bearing or a slipping drive belt.",
  thermal: "The thermal block is overshooting its setpoint while wear climbs, which points to a heating-element or thermal-control fault.",
  temp: "Process temperature has crossed its safe limit, which points to a thermal-control or cooling fault.",
  default: "Several sensors are outside the normal operating envelope.",
};
const PREVENT = {
  heat: "Schedule regular coolant checks and condenser cleaning, and trend the air-to-process temperature gap so it is caught before it narrows.",
  power: "Trend torque and speed, service the drive on a preventive schedule, and check power connectors and the driver board.",
  overstrain: "Enforce tool-wear limits, rebalance the rotor periodically, and replace bearings on schedule rather than on failure.",
  thermal: "Verify thermal calibration and airflow, and keep the block within its rated duty cycle.",
  temp: "Verify thermal calibration and airflow, and keep ambient temperature within the rated range.",
  default: "Set trend-based alerts on the driving sensors and service on a preventive schedule.",
};
const IMPACT_BY_TYPE = {
  "Ventilator": "A failure interrupts respiratory support for the patients on this unit.",
  "MRI Scanner": "A failure halts diagnostic imaging and delays every study queued on it.",
  "Infusion Pump": "A failure interrupts controlled drug or fluid delivery.",
  "ECG Machine": "A failure interrupts cardiac monitoring and delays reads.",
  "Centrifuge": "A failure stalls sample preparation and can invalidate spins in progress.",
  "Spectrometer": "A failure stalls analysis and can invalidate readings in progress.",
  "PCR Thermocycler": "A failure ruins the amplification run in progress and delays results.",
  "HPLC Chromatograph": "A failure stalls separation runs and can invalidate the batch in progress.",
};
const FIX = {
  heat: ["Isolate the unit and let it reach a safe temperature.", "Inspect and flush the cooling loop, clean the condenser, and check the chiller pump.", "Recharge coolant, recalibrate, and verify the temperature gradient returns to normal."],
  power: ["Isolate the unit and lock out power.", "Inspect the drive motor, driver board, and power harness.", "Replace the failed component, re-seat connectors, and verify torque and speed return to range."],
  overstrain: ["Stop the rotor and inspect for vibration and play.", "Replace the rotor bearing and check the drive belt tension.", "Rebalance the rotor and confirm wear and vibration return to baseline."],
  thermal: ["Pause the run and let the block cool.", "Inspect the heating element and thermal sensor for drift.", "Replace the faulty part, recalibrate the block, and verify the setpoint holds."],
  temp: ["Pause the device and check airflow and ambient temperature.", "Inspect the thermal sensor and cooling fan.", "Replace the faulty part, recalibrate, and verify temperature returns to range."],
  default: ["Isolate the unit.", "Inspect the driving components identified above.", "Replace the faulty part and verify readings return to normal."],
};

function rulLine(rul) {
  if (!rul || rul.status === "warming_up") return "Not enough trend yet to project a time to failure.";
  if (rul.status === "imminent") return "Failure is imminent; the device is already in the critical regime.";
  if (rul.status === "declining") {
    const s = rul.eta_seconds;
    return `Estimated time to Critical is about ${s >= 90 ? Math.round(s / 60) + " minutes" : s + " seconds"} at the current trend (projection).`;
  }
  return "No degradation trend right now; the device is stable.";
}

function impactLine(d) {
  let base = `This is a criticality ${d.criticality}/5 device in ${d.location} with ${d.active_dependents} dependent process(es). `;
  base += IMPACT_BY_TYPE[d.type] || "A failure stops this device and the work depending on it.";
  base += d.backup_available
    ? ` A healthy same-type unit (${d.backup_identified}) can take over.`
    : " No healthy same-type unit is currently available, so downtime is direct.";
  return base;
}

async function groqNarrative(d, memory) {
  const { apiKey, model, baseUrl } = config.groq;
  const system =
    "You are a biomedical maintenance engineer. Given a device's live fault data, write a concise, professional maintenance report. " +
    "Respond ONLY as a JSON object with keys: diagnosis, root_cause, workflow_impact, fix_steps (array of 3 short imperative steps), prevention. " +
    "Each string one or two sentences. Do not use em dashes.";
  const payload = {
    device: { id: d.id, type: d.type, location: d.location, criticality: d.criticality },
    status: d.status, failure_mode: d.failure_mode, health: d.health,
    failure_probability: d.failure_probability, drivers: d.top_factors || [],
    envelope_breaches: d.envelope_breaches || [], dependents: d.active_dependents,
    backup_available: d.backup_available, past_incidents: (memory || []).slice(0, 3),
  };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }],
      temperature: 0.3, max_tokens: 700, response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`groq ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

export async function composeReport(d, memory = []) {
  const parts = (d.agent && d.agent.recommended_parts) || recommendParts({ failure_mode: d.failure_mode, memory });
  const k = modeKey(d.failure_mode);
  const pct = Math.round((d.failure_probability || 0) * 100);

  let nar = null;
  if (config.groq.apiKey) {
    try { nar = await groqNarrative(d, memory); }
    catch (e) { console.warn(`[report] Groq failed (${e.message}); using rule-based text`); nar = null; }
  }

  const sections = {
    summary: `${d.id} (${d.type}, ${d.location}) is ${d.status} at ${pct}% failure risk with a health score of ${d.health}%.`,
    diagnosis: (nar && nar.diagnosis) || `${d.failure_mode}. The model flags ${drivers(d)}.`,
    root_cause: (nar && nar.root_cause) || ROOT[k],
    workflow_impact: (nar && nar.workflow_impact) || impactLine(d),
    fix_steps: nar && Array.isArray(nar.fix_steps) && nar.fix_steps.length ? nar.fix_steps : (FIX[k] || FIX.default),
    parts_line: parts.map((p) => p.name).join(", ") || "per manual",
    prevention: (nar && nar.prevention) ||
      ((memory.length > 1 ? `This pattern has recurred ${memory.length} times on this device, so consider replacing the affected part rather than repeating the repair. ` : "") + PREVENT[k]),
    rul: rulLine(d.rul),
    mode: nar ? "groq" : "rule-based",
  };
  const pdf = await buildPdf(d, sections, parts, memory, pct);
  return { sections, parts, filename: `LabSentinel_${d.id}_report.pdf`, pdf };
}

function buildPdf(d, s, parts, memory, pct) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const M = 40, PW = 515;
    const sc = d.status === "Critical" ? "#c0392b" : d.status === "Warning" ? "#b8860b" : "#1e8f4e";

    doc.fillColor("#5a6b78").font("Helvetica-Bold").fontSize(10).text("LABSENTINEL MAINTENANCE REPORT", M, M);
    doc.fillColor("#1a2733").font("Helvetica-Bold").fontSize(22).text(String(d.id), M, doc.y + 2, { continued: true });
    doc.fillColor(sc).fontSize(12).text("   " + d.status);
    doc.font("Helvetica").fontSize(10).fillColor("#5a6b78")
      .text(`${d.type}  |  ${d.location}  |  criticality ${d.criticality}/5  |  ${new Date().toLocaleString()}`, M, doc.y + 2);
    const ly = doc.y + 5;
    doc.moveTo(M, ly).lineTo(M + PW, ly).lineWidth(2).strokeColor(sc).stroke();

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1a2733")
      .text(`Health ${d.health}%       Failure risk ${pct}%       Impact ${d.impact.priority}       Work order ${d.agent ? d.agent.ticket_id : "pending"}`, M, ly + 12);

    // ---- real trend chart ----
    const hist = (d.history || []).slice(-120);
    const cx = M, cw = PW, ch = 150, cy = doc.y + 10;
    doc.roundedRect(cx, cy, cw, ch, 6).fill("#0f1522");
    doc.fillColor("#8091a0").font("Helvetica-Bold").fontSize(9).text("Health and failure-risk trend (this device)", cx + 10, cy + 8);
    doc.fillColor("#22c55e").font("Helvetica").fontSize(8).text("health", cx + cw - 96, cy + 8, { continued: true });
    doc.fillColor("#ef4444").text("    risk");
    const plotX = cx + 30, plotW = cw - 42, plotY = cy + 24, plotH = ch - 40;
    doc.lineWidth(0.5).strokeColor("#2a3550");
    for (let g = 0; g <= 4; g++) {
      const yy = plotY + plotH * (g / 4);
      doc.moveTo(plotX, yy).lineTo(plotX + plotW, yy).stroke();
      doc.fillColor("#66748a").font("Helvetica").fontSize(7).text(String(100 - g * 25), cx + 8, yy - 3);
    }
    if (hist.length > 1) {
      const px = (i) => plotX + (i / (hist.length - 1)) * plotW;
      const py = (v) => plotY + plotH * (1 - Math.max(0, Math.min(100, v)) / 100);
      doc.lineWidth(1.4).strokeColor("#22c55e");
      hist.forEach((h, i) => { const X = px(i), Y = py(h.health); i ? doc.lineTo(X, Y) : doc.moveTo(X, Y); });
      doc.stroke();
      doc.lineWidth(1.4).strokeColor("#ef4444");
      hist.forEach((h, i) => { const X = px(i), Y = py(Math.round((h.probability || 0) * 100)); i ? doc.lineTo(X, Y) : doc.moveTo(X, Y); });
      doc.stroke();
    } else {
      doc.fillColor("#66748a").fontSize(9).text("Trend appears once enough live readings are collected.", plotX + 20, plotY + plotH / 2 - 4);
    }

    doc.x = M; doc.y = cy + ch + 14;
    const H = (t) => { doc.moveDown(0.5); doc.font("Helvetica-Bold").fontSize(11).fillColor("#33566e").text(t, M, doc.y, { width: PW }); };
    const P = (t) => { doc.moveDown(0.12); doc.font("Helvetica").fontSize(10).fillColor("#22303c").text(t, M, doc.y, { width: PW }); };
    H("Summary"); P(s.summary);
    H("Diagnosis (what is happening)"); P(s.diagnosis);
    H("Root cause (why)"); P(s.root_cause);
    H("Impact on the workflow"); P(s.workflow_impact);
    H("Remaining useful life"); P(s.rul);
    H("How to fix"); s.fix_steps.forEach((st, i) => P(`${i + 1}. ${st}`)); P(`Parts to order (LabX): ${s.parts_line}`);
    H("How to prevent recurrence"); P(s.prevention);
    if (memory.length) {
      H(`Past incidents (${memory.length})`);
      memory.slice(0, 4).forEach((m) => P(`${new Date(m.timestamp).toLocaleDateString()}: ${m.failure_mode} -> ${m.action_taken}`));
    }
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(8).fillColor("#8493a0")
      .text(`Generated automatically by LabSentinel (${s.mode}) from live sensor data, a trained failure model, and this device's history. Actions are recommendations for the maintenance team.`, M, doc.y, { width: PW });
    doc.end();
  });
}
