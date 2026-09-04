import { useMemo, useState } from "react";
import { simulateFailure } from "../api";

/** Global search + trigger for the "Simulate Failure" demo action. */
export default function SimulateControl({ devices }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = devices.filter(
      (d) =>
        !s ||
        d.id.toLowerCase().includes(s) ||
        d.type.toLowerCase().includes(s) ||
        d.location.toLowerCase().includes(s)
    );
    return list.slice(0, 8);
  }, [q, devices]);

  async function trigger(id) {
    setBusy(id);
    try {
      await simulateFailure(id);
      setQ("");
      setOpen(false);
    } finally {
      setTimeout(() => setBusy(""), 600);
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-critical/40 bg-critical/10 px-3 py-1.5">
        <span className="text-critical">⚡</span>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Simulate failure - search device…"
          className="w-64 bg-transparent text-sm text-slate-100 placeholder-critical/60 outline-none"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute right-0 z-30 mt-2 w-72 max-h-80 overflow-auto rounded-xl border border-ink-500 bg-ink-800 p-1 shadow-2xl">
          {matches.map((d) => (
            <button
              key={d.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => trigger(d.id)}
              disabled={busy === d.id}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-600/70"
            >
              <span>
                <span className="font-semibold text-slate-100">{d.id}</span>
                <span className="ml-2 text-xs text-slate-400">{d.type}</span>
              </span>
              <span className="text-xs text-critical">
                {busy === d.id ? "ramping…" : d.failing ? "failing" : "ramp →"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
