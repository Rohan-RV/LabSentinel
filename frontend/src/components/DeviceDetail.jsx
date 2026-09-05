import { useState } from "react";
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
import { STATUS, PRIORITY, fmtFeature, fmtRul, simulateFailure, resolveDevice, orderParts } from "../api";
import TwinPanel from "./TwinPanel";
import Device3DPanel from "./Device3D";

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

function TrendChart({ history }) {
  const data = history.map((h) => ({
    t: new Date(h.t).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
    health: h.health,
    risk: Math.round(h.probability * 100),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
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
        <Area type="monotone" dataKey="health" stroke="#22c55e" strokeWidth={2} fill="url(#hg)" name="Health %" />
        <Line type="monotone" dataKey="risk" stroke="#ef4444" strokeWidth={2} dot={false} name="Failure risk %" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function PartsOrder({ device, agent, detail }) {
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const existing = order || (detail && detail.partsOrder) || null;
  const parts = (agent && agent.recommended_parts) || [];
  if (!parts.length && !existing) return null;
  async function doOrder() {
    setBusy(true);
    try { const o = await orderParts(device.id); setOrder(o); } catch (e) { /* ignore */ } finally { setBusy(false); }
  }
  return (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-cyan-300">
          Parts to order (LabX)
        </span>
        {!existing && (
          <button
            onClick={doOrder}
            disabled={busy}
            className="rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-60"
          >
            {busy ? "Ordering..." : "Order parts"}
          </button>
        )}
      </div>
      {existing ? (
        <div className="space-y-1 text-xs text-slate-300">
          <div className="font-semibold text-healthy">
            Order {existing.order_id} placed with {existing.supplier}
          </div>
          {existing.items.map((it, i) => (
            <div key={i} className="flex justify-between">
              <span>{it.name} <span className="text-slate-500">({it.sku})</span></span>
              <span className="font-mono">INR {it.price}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-ink-600/60 pt-1 font-semibold">
            <span>Total, ETA {existing.eta_hours}h</span>
            <span className="font-mono">INR {existing.total}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            {existing.simulated ? "simulated order, connect the LabX API to place for real" : "sent to LabX"}
          </div>
        </div>
      ) : (
        <ul className="space-y-1 text-xs text-slate-300">
          {parts.map((it, i) => (
            <li key={i} className="flex justify-between">
              <span>{it.name} <span className="text-slate-500">({it.sku})</span></span>
              <span className="font-mono">INR {it.price}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentPanel({ agent, device, detail }) {
  if (!agent) {
    return (
      <p className="text-sm text-slate-500">
        Agent runs automatically when this device becomes Critical.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="leading-relaxed text-slate-200">{agent.natural_language_summary}</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Kv k="Diagnosis" v={agent.diagnosis} span />
        <Kv k="Recommended action" v={agent.recommended_action} span />
        <Kv k="Work order" v={agent.ticket_id} />
        <Kv k="Technician" v={agent.technician_assigned} />
        <Kv
          k="Failover (live)"
          v={
            device && device.backup_available
              ? `${device.backup_identified} - healthy, ready`
              : "No healthy standby"
          }
        />
        <Kv k="Status" v={agent.status} />
      </div>
      <PartsOrder device={device} agent={agent} detail={detail} />
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span
          className={`rounded px-1.5 py-0.5 font-semibold ${
            agent.mode === "llm"
              ? "bg-violet-500/15 text-violet-300"
              : "bg-slate-500/15 text-slate-300"
          }`}
        >
          {agent.mode === "llm" ? "LLM reasoning" : "rule-based fallback"}
        </span>
        <span>simulated action - no external system contacted</span>
      </div>
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

function RulLine({ rul, metrics }) {
  let live;
  if (!rul || rul.status === "warming_up") {
    live = <span className="text-slate-500">Collecting readings for a projection...</span>;
  } else if (rul.status === "imminent") {
    live = <span className="text-critical">Failure imminent - operating in the critical regime (live projection)</span>;
  } else if (rul.status === "declining") {
    const s = rul.eta_seconds;
    const t = s >= 90 ? `${Math.round(s / 60)}m` : `${s}s`;
    live = <span className="text-warning">Estimated time to Critical: ~{t} (live projection)</span>;
  } else {
    live = <span className="text-healthy">No degradation trend; device stable.</span>;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="font-medium">{live}</span>
      {metrics && metrics.rmse !== undefined && (
        <span className="text-slate-500">
          RUL model: XGBoost on NASA C-MAPSS, RMSE {metrics.rmse} cyc
        </span>
      )}
    </div>
  );
}

export default function DeviceDetail({ device, detail, rulMetrics, onClose }) {
  const [tab, setTab] = useState("overview");
  const [reportBusy, setReportBusy] = useState(false);
  async function downloadReport() {
    setReportBusy(true);
    try {
      const res = await fetch(`/api/devices/${device.id}/report`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `LabSentinel_${device.id}_report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { /* ignore */ } finally { setReportBusy(false); }
  }
  if (!device) return null;
  const st = STATUS[device.status];
  const readings = device.lastReading?.readings || {};
  const history = detail?.history || device.history || [];
  const agent = detail?.agent || null;
  const memory = detail?.memory || [];
  const imp = device.impact;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="my-4 w-full max-w-3xl rounded-2xl border border-ink-500 bg-ink-900/95 shadow-2xl">
        {/* header */}
        <div className="flex items-start justify-between border-b border-ink-500/60 p-5">
          <div>
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${st.bg}`} />
              <h2 className="text-xl font-bold text-slate-100">{device.id}</h2>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${st.soft} border`}>
                {device.status}
              </span>
              {device.status !== "Healthy" && (
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PRIORITY[imp.priority]}`}>
                  {imp.priority} priority
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-slate-400">
              {device.type} · {device.location} · criticality {device.criticality}/5 ·{" "}
              {device.sensors_reported}/{device.sensors_expected} sensors reporting
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => simulateFailure(device.id)}
              className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-1.5 text-xs font-semibold text-critical hover:bg-critical/20"
            >
              Simulate failure
            </button>
            <button
              onClick={downloadReport}
              disabled={reportBusy}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-60"
            >
              {reportBusy ? "Preparing..." : "Download report"}
            </button>
            <button
              onClick={() => resolveDevice(device.id)}
              className="rounded-lg border border-healthy/40 bg-healthy/10 px-3 py-1.5 text-xs font-semibold text-healthy hover:bg-healthy/20"
            >
              Reset / resolve
            </button>
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-slate-400 hover:bg-ink-600/60">
              ✕
            </button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-ink-500/60 px-5 pt-3">
          {["overview", "twin", "3d"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t-md px-3 py-1.5 text-xs font-semibold transition ${
                tab === t ? "bg-ink-700 text-slate-100" : "text-slate-400 hover:bg-ink-600/50"
              }`}
            >
              {t === "overview" ? "Overview" : t === "twin" ? "Digital Twin" : "3D Model"}
            </button>
          ))}
        </div>

        <div hidden={tab !== "overview"} className="grid gap-4 p-5 md:grid-cols-2">
          {/* trend */}
          <div className="md:col-span-2">
            <Section
              title="Health & failure-risk trend"
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
              {history.length > 1 ? (
                <TrendChart history={history} />
              ) : (
                <div className="py-12 text-center text-sm text-slate-500">
                  Collecting live readings… trend appears within a few ticks.
                </div>
              )}
            </Section>
          </div>

          {/* remaining useful life */}
          <div className="md:col-span-2">
            <Section title="Remaining useful life">
              <RulLine rul={device.rul} metrics={rulMetrics} />
            </Section>
          </div>

          {/* live readings */}
          <Section title="Live sensor readings">
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
              {device.reports
                .filter((f) => readings[f] === null || readings[f] === undefined)
                .map((f) => (
                  <div key={f} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-500">{fmtFeature(f)}</span>
                    <span className="font-mono text-amber-400/70">null (dropout)</span>
                  </div>
                ))}
            </div>
          </Section>

          {/* explainability + impact */}
          <Section title="Why this score">
            <div className="space-y-1.5">
              {(device.envelope_breaches || []).map((b) => (
                <div key={b.feature} className="flex items-center justify-between text-sm">
                  <span className="text-critical">⚠ {b.label} over safe limit</span>
                  <span className="font-mono text-critical">
                    {b.value}
                    {b.unit}
                  </span>
                </div>
              ))}
              {(device.top_factors || []).map((f) => (
                <div key={f.feature} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-slate-300">
                    {f.direction === "raises_risk" ? "↑" : "↓"} {fmtFeature(f.feature)}
                  </span>
                  <span
                    className={`font-mono text-xs ${
                      f.direction === "raises_risk" ? "text-critical" : "text-healthy"
                    }`}
                  >
                    {f.value ?? "-"}
                  </span>
                </div>
              ))}
              {(!device.top_factors || device.top_factors.length === 0) &&
                (!device.envelope_breaches || device.envelope_breaches.length === 0) && (
                  <p className="text-sm text-slate-500">Nominal - no risk drivers.</p>
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

          {/* agent */}
          <div className="md:col-span-2">
            <Section title="Autonomous agent">
              <AgentPanel agent={agent} device={device} detail={detail} />
            </Section>
          </div>

          {/* memory */}
          <div className="md:col-span-2">
            <Section title={`Maintenance memory (${memory.length})`}>
              {memory.length === 0 ? (
                <p className="text-sm text-slate-500">No prior incidents on record.</p>
              ) : (
                <ul className="space-y-2">
                  {memory.map((m, i) => (
                    <li key={i} className="rounded-lg bg-ink-700/50 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200">{m.failure_mode}</span>
                        <span className="text-xs text-slate-500">
                          {new Date(m.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="mt-1 text-slate-400">{m.action_taken}</div>
                      {m.parts_replaced?.length > 0 && (
                        <div className="mt-1 text-xs text-slate-500">
                          Parts: {m.parts_replaced.join(", ")}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-healthy/80">{m.resolution}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>

        <div hidden={tab !== "twin"}>
          <TwinPanel device={device} detail={detail} />
        </div>

        {tab === "3d" && (
          <div className="p-5">
            <Device3DPanel device={device} />
          </div>
        )}
      </div>
    </div>
  );
}
