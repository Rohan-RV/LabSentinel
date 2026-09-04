import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { STATUS, PRIORITY, fmtFeature } from "../api";

const UNITS = {
  air_temperature: "K",
  process_temperature: "K",
  rotational_speed: "rpm",
  torque: "Nm",
  tool_wear: "min",
};

function Section({ title, children, right }) {
  return (
    <div className="rounded-xl border border-ink-500/60 bg-ink-800/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Kv({ k, v, span }) {
  return (
    <div className={`rounded-lg bg-ink-700/60 px-2.5 py-2 ${span ? "col-span-2" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className="mt-0.5 text-slate-200">{v}</div>
    </div>
  );
}

function TrendChart({ trajectory }) {
  const data = trajectory.map((h) => ({
    t: new Date(h.t).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
    health: h.health,
    risk: Math.round(h.probability * 100),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="lhg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1e2740" vertical={false} />
        <XAxis dataKey="t" tick={{ fill: "#64748b", fontSize: 10 }} minTickGap={40} />
        <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: "#0f1522", border: "1px solid #2a3550", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#94a3b8" }}
        />
        <Area type="monotone" dataKey="health" stroke="#22c55e" strokeWidth={2} fill="url(#lhg)" name="Health %" />
        <Line type="monotone" dataKey="risk" stroke="#ef4444" strokeWidth={2} dot={false} name="Failure risk %" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function rulText(rul) {
  if (!rul || rul.status === "warming_up") return { text: "Not enough readings in the file to project a trend.", cls: "text-slate-500" };
  if (rul.status === "imminent") return { text: "Failure imminent - the log ends in the critical regime (projection).", cls: "text-critical" };
  if (rul.status === "declining") {
    const s = rul.eta_seconds;
    const t = s >= 90 ? `${Math.round(s / 60)}m` : `${s}s`;
    return { text: `Estimated time to Critical: ~${t} from the log's end (projection).`, cls: "text-warning" };
  }
  return { text: "No degradation trend across the log; device stable.", cls: "text-healthy" };
}

export default function LogAnalysis({ result, onClose }) {
  if (!result) return null;
  const { device, final, worst, trajectory, rul, memory = [], agent, source } = result;
  const st = STATUS[final.status] || STATUS.Healthy;
  const imp = final.impact;
  const readings = final.readings || {};
  const proj = rulText(rul);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="my-4 w-full max-w-3xl rounded-2xl border border-ink-500 bg-ink-900/95 shadow-2xl">
        <div className="flex items-start justify-between border-b border-ink-500/60 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${st.bg}`} />
              <h2 className="text-xl font-bold text-slate-100">{device.id}</h2>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${st.soft} border`}>{final.status}</span>
              {final.status !== "Healthy" && (
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PRIORITY[imp.priority]}`}>
                  {imp.priority} priority
                </span>
              )}
              <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                LOG ANALYSIS
              </span>
            </div>
            <div className="mt-1 text-sm text-slate-400">
              {device.type} · {device.location} · criticality {device.criticality}/5
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {source.filename ? `${source.filename} · ` : ""}{source.n_readings} readings ·{" "}
              {source.model_used ? "scored by the ML model" : "model offline - envelope-only scoring (start serve.py for ML)"}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-slate-400 hover:bg-ink-600/60">
            ✕
          </button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <Section
              title="Health & failure-risk trajectory (over the log)"
              right={
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1 text-healthy">
                    <span className="inline-block h-2 w-2 rounded-full bg-healthy" /> health
                  </span>
                  <span className="flex items-center gap-1 text-critical">
                    <span className="inline-block h-2 w-2 rounded-full bg-critical" /> risk
                  </span>
                </div>
              }
            >
              {trajectory.length > 1 ? (
                <TrendChart trajectory={trajectory} />
              ) : (
                <div className="py-12 text-center text-sm text-slate-500">Single reading - no trajectory to chart.</div>
              )}
            </Section>
          </div>

          <div className="md:col-span-2">
            <Section title="Remaining useful life">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className={`font-medium ${proj.cls}`}>{proj.text}</span>
                <span className="text-slate-500">
                  final health {final.health}% · worst in log {worst.health}%
                </span>
              </div>
            </Section>
          </div>

          <Section title="Final sensor readings">
            <div className="space-y-1.5">
              {Object.entries(readings)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-400">{fmtFeature(k)}</span>
                    <span className="font-mono text-slate-100">
                      {v} <span className="text-slate-500">{UNITS[k]}</span>
                    </span>
                  </div>
                ))}
            </div>
          </Section>

          <Section title="Why this score">
            <div className="space-y-1.5">
              {(final.envelope_breaches || []).map((b) => (
                <div key={b.feature} className="flex items-center justify-between text-sm">
                  <span className="text-critical">⚠ {b.label} over safe limit</span>
                  <span className="font-mono text-critical">
                    {b.value}
                    {b.unit}
                  </span>
                </div>
              ))}
              {(final.top_factors || []).map((f) => (
                <div key={f.feature} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-slate-300">
                    {f.direction === "raises_risk" ? "↑" : "↓"} {fmtFeature(f.feature)}
                  </span>
                  <span className={`font-mono text-xs ${f.direction === "raises_risk" ? "text-critical" : "text-healthy"}`}>
                    {f.value ?? "-"}
                  </span>
                </div>
              ))}
              {(!final.top_factors || final.top_factors.length === 0) &&
                (!final.envelope_breaches || final.envelope_breaches.length === 0) && (
                  <p className="text-sm text-slate-500">Nominal - no risk drivers at end of log.</p>
                )}
            </div>
            <div className="mt-3 border-t border-ink-600/60 pt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                Impact priority - {imp.priority}
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-slate-400">
                <span>criticality: {imp.factors.criticality}/5</span>
                <span>dependents: {imp.factors.active_dependents}</span>
                <span>backup: {imp.factors.backup_available ? "yes" : "no"}</span>
                <span>impact score: {imp.impact_score}</span>
              </div>
            </div>
          </Section>

          <div className="md:col-span-2">
            <Section title="Autonomous agent diagnosis">
              {agent ? (
                <div className="space-y-3 text-sm">
                  <p className="leading-relaxed text-slate-200">{agent.natural_language_summary}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Kv k="Diagnosis" v={agent.diagnosis} span />
                    <Kv k="Recommended action" v={agent.recommended_action} span />
                    <Kv k="Work order" v={agent.ticket_id} />
                    <Kv k="Technician" v={agent.technician_assigned} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${agent.mode === "llm" ? "bg-violet-500/15 text-violet-300" : "bg-slate-500/15 text-slate-300"}`}>
                      {agent.mode === "llm" ? "LLM reasoning" : "rule-based fallback"}
                    </span>
                    <span>one-shot analysis - not persisted as a live work order</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No diagnosis produced.</p>
              )}
            </Section>
          </div>

          {memory.length > 0 && (
            <div className="md:col-span-2">
              <Section title={`Maintenance memory (${memory.length})`}>
                <ul className="space-y-2">
                  {memory.map((m, i) => (
                    <li key={i} className="rounded-lg bg-ink-700/50 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200">{m.failure_mode}</span>
                        <span className="text-xs text-slate-500">{new Date(m.timestamp).toLocaleDateString()}</span>
                      </div>
                      <div className="mt-1 text-slate-400">{m.action_taken}</div>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
