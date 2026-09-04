import { io } from "socket.io-client";

// REST goes through Vite's /api proxy; the realtime socket connects straight to
// the backend origin (avoids dev-proxy WebSocket-upgrade quirks).
const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
export const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });

export async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export async function postJSON(path) {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export const simulateFailure = (id) => postJSON(`/api/simulate-failure/${id}`);
export const resolveDevice = (id) => postJSON(`/api/devices/${id}/resolve`);
export const orderParts = (id) => postJSON(`/api/devices/${id}/order-parts`);
export const fetchDevice = (id) => getJSON(`/api/devices/${id}`);
export const fetchMetrics = () => getJSON(`/api/metrics`);
export const fetchRulMetrics = () => getJSON(`/api/rul-metrics`);

export async function simulateTwin(id, body) {
  const res = await fetch(`/api/twin/${id}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `twin -> ${res.status}`;
    try {
      const e = await res.json();
      if (e.error) msg = e.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function analyzeLog(payload) {
  const res = await fetch("/api/analyze-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `analyze-log -> ${res.status}`;
    try {
      const e = await res.json();
      if (e.error) msg = e.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

// ---- shared presentation helpers ----
export const STATUS = {
  Healthy: { text: "text-healthy", bg: "bg-healthy", ring: "#22c55e", soft: "bg-healthy/10 text-healthy border-healthy/30" },
  Warning: { text: "text-warning", bg: "bg-warning", ring: "#f59e0b", soft: "bg-warning/10 text-warning border-warning/30" },
  Critical: { text: "text-critical", bg: "bg-critical", ring: "#ef4444", soft: "bg-critical/10 text-critical border-critical/30" },
};

export const PRIORITY = {
  Critical: "bg-critical/15 text-critical border border-critical/40",
  High: "bg-orange-500/15 text-orange-300 border border-orange-500/40",
  Medium: "bg-warning/15 text-warning border border-warning/40",
  Low: "bg-slate-500/15 text-slate-300 border border-slate-500/40",
};

export function fmtFeature(f) {
  return f.replace(/_/g, " ");
}

// Format a device's live RUL projection into a short label, or null when the
// device is stable / still warming up (nothing to show).
export function fmtRul(rul) {
  if (!rul) return null;
  if (rul.status === "declining") {
    const s = rul.eta_seconds;
    const t = s >= 90 ? `${Math.round(s / 60)}m` : `${s}s`;
    return { text: `~${t} to ${rul.to}`, tone: rul.to === "failure" ? "critical" : "warning" };
  }
  if (rul.status === "imminent") return { text: "failure imminent", tone: "critical" };
  return null;
}
