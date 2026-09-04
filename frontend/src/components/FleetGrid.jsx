import { useMemo, useState } from "react";
import DeviceCard from "./DeviceCard";

const ORDER = { Critical: 0, Warning: 1, Healthy: 2 };

export default function FleetGrid({ devices, onOpen }) {
  const [filter, setFilter] = useState("All");

  const sorted = useMemo(() => {
    return [...devices]
      .filter((d) => filter === "All" || d.status === filter)
      .sort((a, b) => {
        const o = ORDER[a.status] - ORDER[b.status];
        if (o !== 0) return o;
        if (a.status !== "Healthy") return a.health - b.health; // worst first
        return a.id.localeCompare(b.id);
      });
  }, [devices, filter]);

  const counts = useMemo(() => {
    const c = { All: devices.length, Critical: 0, Warning: 0, Healthy: 0 };
    devices.forEach((d) => (c[d.status] += 1));
    return c;
  }, [devices]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Fleet ({devices.length})
        </h2>
        <div className="flex gap-1">
          {["All", "Critical", "Warning", "Healthy"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                filter === f
                  ? "bg-ink-500 text-slate-100"
                  : "text-slate-400 hover:bg-ink-600/60"
              }`}
            >
              {f} <span className="text-slate-500">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map((d) => (
          <DeviceCard key={d.id} device={d} onOpen={onOpen} />
        ))}
      </div>
      {sorted.length === 0 && (
        <div className="rounded-xl border border-ink-500/60 bg-ink-700/40 p-8 text-center text-sm text-slate-500">
          No devices in this state.
        </div>
      )}
    </div>
  );
}
