import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { simulateTwin, fmtFeature } from "../api";
import DeviceSchematic from "./DeviceSchematic";

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

function fmtSecs(s) {
  if (s == null) return "-";
  return s >= 90 ? `${Math.round(s / 60)}m` : `${s}s`;
}

function Residual({ feature, expected, actual }) {
  if (expected == null || actual == null) return null;
  const delta = actual - expected;
  const frac = Math.abs(delta) / (Math.abs(expected) || 1);
  const tone = frac < 0.05 ? "healthy" : frac < 0.15 ? "warning" : "critical";
  const color = tone === "healthy" ? "#22c55e" : tone === "warning" ? "#f59e0b" : "#ef4444";
  const width = Math.min(100, frac * 300);
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between">
        <span className="capitalize text-slate-300">{fmtFeature(feature)}</span>
        <span className="font-mono text-slate-400">
          exp {expected} · act <span className="text-slate-100">{actual}</span>{" "}
          <span style={{ color }}>
            ({delta >= 0 ? "+" : ""}
            {Math.round(delta * 100) / 100} {UNITS[feature]})
          </span>
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-500/60">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
    </div>
  );
}

export default function TwinPanel({ device, detail }) {
  const [load, setLoad] = useState(1.0);
  const [ambient, setAmbient] = useState(0);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    if (!device) return;
    setBusy(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await simulateTwin(device.id, {
          steps: 40,
          load_factor: load,
          ambient_offset: ambient,
        });
        setResult(r);
        setErr("");
      } catch (e) {
        setErr(e.message || "simulation failed");
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [device && device.id, load, ambient]);

  const expected = (result && result.expected_normal) || {};
  const current = (result && result.current) || (device && device.lastReading && device.lastReading.readings) || {};
  const reports = (result && result.device && result.device.reports) || (device && device.reports) || [];
  const ttc = result ? result.time_to_critical_sec : null;
  const modelUsed = result ? result.model_used : true;

  const chartData = useMemo(() => {
    const rows = [];
    const hist = ((detail && detail.history) || (device && device.history) || []).slice(-30);
    const nowMs = hist.length ? new Date(hist[hist.length - 1].t).getTime() : Date.now();
    hist.forEach((h) => {
      rows.push({ t: Math.round((new Date(h.t).getTime() - nowMs) / 1000), actual: h.health });
    });
    ((result && result.projection) || []).forEach((p) => {
      rows.push({ t: p.t, projected: p.health, risk: Math.round(p.risk * 100) });
    });
    return rows;
  }, [detail, device, result]);

  const verdict =
    ttc != null
      ? { text: `Projected to reach Critical in ~${fmtSecs(ttc)} under this scenario`, cls: "text-critical" }
      : { text: "Stays out of the Critical range across the projected horizon", cls: "text-healthy" };

  return (
    <div className="space-y-4 p-5">
      <Section title="Device model (2D): fault localisation">
        <DeviceSchematic device={device} />
      </Section>
      <Section
        title="What-if scenario"
        right={busy ? <span className="text-[11px] text-slate-500">simulating...</span> : null}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-slate-400">
            <div className="mb-1 flex justify-between">
              <span>Load / duty factor</span>
              <span className="font-mono text-slate-200">{load.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={load}
              onChange={(e) => setLoad(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            <div className="mb-1 flex justify-between">
              <span>Ambient temp offset</span>
              <span className="font-mono text-slate-200">
                {ambient > 0 ? "+" : ""}
                {ambient} K
              </span>
            </div>
            <input
              type="range"
              min="-8"
              max="8"
              step="1"
              value={ambient}
              onChange={(e) => setAmbient(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-600/60 pt-3 text-sm">
          <span className={`font-semibold ${verdict.cls}`}>{verdict.text}</span>
          <button
            onClick={() => {
              setLoad(1.0);
              setAmbient(0);
            }}
            className="rounded-md border border-ink-500/60 px-2 py-1 text-[11px] text-slate-400 hover:bg-ink-600/50"
          >
            reset scenario
          </button>
        </div>
        {!modelUsed && (
          <p className="mt-2 text-[11px] text-amber-400/80">
            Prediction service offline - projection uses the envelope guard only. Start serve.py for full ML scoring.
          </p>
        )}
        {err && <p className="mt-2 text-[11px] text-critical">{err}</p>}
      </Section>

      <Section
        title="Twin projection: actual history, then forward simulation"
        right={
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-healthy">actual</span>
            <span className="text-emerald-300">projected</span>
            <span className="text-critical">risk</span>
          </div>
        }
      >
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#1e2740" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickFormatter={(v) => (v === 0 ? "now" : `${v > 0 ? "+" : ""}${v}s`)}
              />
              <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "#0f1522", border: "1px solid #2a3550", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => (v === 0 ? "now" : `${v > 0 ? "+" : ""}${v}s`)}
              />
              <ReferenceLine x={0} stroke="#475569" strokeDasharray="3 3" />
              <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="actual" stroke="#22c55e" strokeWidth={2} dot={false} name="Health (actual)" connectNulls={false} />
              <Line type="monotone" dataKey="projected" stroke="#34d399" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Health (projected)" connectNulls={false} />
              <Line type="monotone" dataKey="risk" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Risk % (projected)" connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-12 text-center text-sm text-slate-500">Collecting live readings for the twin...</div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          Data-driven twin: the device-type degradation model run forward from the current state and scored by the same model. The dashed red line at 40% marks the Critical threshold.
        </p>
      </Section>

      <Section title="Expected vs actual (residual = damage signature)">
        <div className="space-y-2.5">
          {reports.map((f) => (
            <Residual key={f} feature={f} expected={expected[f]} actual={current[f]} />
          ))}
          {reports.length === 0 && <p className="text-sm text-slate-500">No sensors reported.</p>}
        </div>
      </Section>
    </div>
  );
}
