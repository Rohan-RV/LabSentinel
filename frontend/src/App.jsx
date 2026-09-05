import { useEffect, useMemo, useRef, useState } from "react";
import { socket, getJSON, fetchDevice, fetchMetrics, fetchRulMetrics } from "./api";
import SystemOverview from "./components/SystemOverview";
import MetricsBadge from "./components/MetricsBadge";
import RulBadge from "./components/RulBadge";
import LogUpload from "./components/LogUpload";
import LogAnalysis from "./components/LogAnalysis";
import SimulateControl from "./components/SimulateControl";
import FleetGrid from "./components/FleetGrid";
import AlertsPanel from "./components/AlertsPanel";
import DeviceDetail from "./components/DeviceDetail";
import SplashIntro from "./components/SplashIntro";

const PR = { Critical: 4, High: 3, Medium: 2, Low: 1 };
const HISTORY_LEN = 120;

export default function App() {
  const [devices, setDevices] = useState([]);
  const [stats, setStats] = useState(null);
  const [meta, setMeta] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [rulMetrics, setRulMetrics] = useState(null);
  const [logResult, setLogResult] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("ls-theme") || "dark"; } catch { return "dark"; } });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [intro, setIntro] = useState(true);

  const selRef = useRef(null);
  useEffect(() => {
    selRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const el = document.documentElement;
    if (theme === "light") el.classList.add("light");
    else el.classList.remove("light");
    try { localStorage.setItem("ls-theme", theme); } catch (e) { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    function onFleet(payload) {
      setDevices(payload.devices);
      setStats(payload.stats);
      setMeta(payload.meta);
      const id = selRef.current;
      if (id) {
        const dev = payload.devices.find((d) => d.id === id);
        if (dev) {
          setDetail((prev) => {
            if (!prev) return prev;
            const t = dev.lastReading?.timestamp;
            const hist = prev.history ? [...prev.history] : [];
            if (!hist.length || hist[hist.length - 1].t !== t) {
              hist.push({ t, health: dev.health, probability: dev.failure_probability });
              if (hist.length > HISTORY_LEN) hist.shift();
            }
            return { ...prev, history: hist };
          });
        }
      }
    }
    function onAlert(ev) {
      setAlerts((prev) => {
        if (prev.some((a) => a.id === ev.id)) return prev;
        return [ev, ...prev].slice(0, 40);
      });
    }
    function onAgent({ device_id, agent, memory }) {
      if (selRef.current === device_id) {
        setDetail((prev) => (prev ? { ...prev, agent, memory } : prev));
      }
    }

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("fleet:update", onFleet);
    socket.on("alert", onAlert);
    socket.on("agent:update", onAgent);
    socket.on("model:metrics", setMetrics);
    socket.on("rul:metrics", setRulMetrics);

    getJSON("/api/alerts?limit=40").then(setAlerts).catch(() => {});
    fetchMetrics().then(setMetrics).catch(() => {});
    fetchRulMetrics().then(setRulMetrics).catch(() => {});

    return () => {
      socket.off("fleet:update", onFleet);
      socket.off("alert", onAlert);
      socket.off("agent:update", onAgent);
      socket.off("model:metrics", setMetrics);
      socket.off("rul:metrics", setRulMetrics);
    };
  }, []);

  async function openDevice(id) {
    setSelectedId(id);
    try {
      const d = await fetchDevice(id);
      setDetail(d);
    } catch {
      setDetail(null);
    }
  }
  function closeDevice() {
    setSelectedId(null);
    setDetail(null);
  }

  const sortedAlerts = useMemo(() => {
    return [...alerts].sort((a, b) => {
      const p = (PR[b.priority] || 0) - (PR[a.priority] || 0);
      if (p !== 0) return p;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
  }, [alerts]);

  const selectedDevice = devices.find((d) => d.id === selectedId) || null;

  return (
    <div className="min-h-full">
      {intro && <SplashIntro onDone={() => setIntro(false)} />}
      {/* top bar */}
      <header className="ls-glass sticky top-0 z-20 border-b border-ink-500/50 bg-ink-900/80 backdrop-blur">
        <span className="ls-flowline pointer-events-none absolute inset-x-0 bottom-0 h-px" />
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 font-bold text-[#0a0e17] shadow-[0_0_18px_-2px_rgba(52,211,153,0.6)]">
              LS
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-none tracking-tight text-slate-100">
                LabSentinel
              </h1>
              <p className="text-[11px] text-slate-400">
                Predictive maintenance · live fleet monitoring
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="ls-switch"
              role="switch"
              aria-checked={theme === "light"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              <span className="ls-switch__knob">{theme === "light" ? "☀" : "☽"}</span>
            </button>
            <ConnPill connected={connected} meta={meta} />
            <MetricsBadge metrics={metrics} />
            <RulBadge metrics={rulMetrics} />
            {/* Analyze log file temporarily hidden */}
            <SimulateControl devices={devices} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-5">
        <div className="ls-enter">
          <SystemOverview stats={stats} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="ls-enter" style={{ animationDelay: "80ms" }}>
            <FleetGrid devices={devices} onOpen={openDevice} />
          </div>
          <div className="ls-enter lg:h-[calc(100vh-240px)] lg:sticky lg:top-[84px]" style={{ animationDelay: "160ms" }}>
            <AlertsPanel alerts={sortedAlerts} onOpen={openDevice} />
          </div>
        </div>
      </main>

      {selectedId && (
        <DeviceDetail device={selectedDevice} detail={detail} rulMetrics={rulMetrics} onClose={closeDevice} />
      )}

      {logResult && <LogAnalysis result={logResult} onClose={() => setLogResult(null)} />}
    </div>
  );
}

function ConnPill({ connected, meta }) {
  const predUp = meta?.prediction_up;
  const label = !connected
    ? "disconnected"
    : predUp === false
    ? "model offline"
    : "live";
  const color = !connected
    ? "bg-critical"
    : predUp === false
    ? "bg-warning"
    : "bg-healthy";
  return (
    <span className="flex items-center gap-2 rounded-lg border border-ink-500/60 bg-ink-700/60 px-2.5 py-1.5 text-xs text-slate-300">
      <span className={`h-2 w-2 rounded-full ${color} ${connected ? "animate-pulse ls-dot-glow" : ""}`} />
      {label}
      {meta && <span className="text-slate-500">· {meta.tick_seconds}s tick</span>}
    </span>
  );
}
