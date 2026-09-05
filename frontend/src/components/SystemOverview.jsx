function Stat({ label, value, sub, accent = "text-slate-100", ring }) {
  return (
    <div className="ls-lift ls-glass flex-1 min-w-[150px] rounded-xl bg-ink-700/70 border border-ink-500/60 px-4 py-3 backdrop-blur">
      <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${accent}`}>{value}</span>
        {sub && <span className="text-xs text-slate-400">{sub}</span>}
      </div>
      {ring !== undefined && (
        <div className="ls-shimmer mt-2 h-1.5 w-full rounded-full bg-ink-500/70 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${ring}%`,
              background: ring >= 70 ? "#22c55e" : ring >= 40 ? "#f59e0b" : "#ef4444",
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function SystemOverview({ stats }) {
  if (!stats) return null;
  const health = stats.fleet_health;
  return (
    <div className="flex flex-wrap gap-3">
      <Stat label="Active Devices" value={stats.active_devices} sub="monitored" />
      <Stat
        label="Fleet Health"
        value={`${health}%`}
        accent={health >= 70 ? "text-healthy" : health >= 40 ? "text-warning" : "text-critical"}
        ring={health}
      />
      <Stat
        label="Critical Alerts"
        value={stats.critical_alerts}
        accent={stats.critical_alerts ? "text-critical" : "text-slate-100"}
      />
      <Stat
        label="Warnings"
        value={stats.warnings}
        accent={stats.warnings ? "text-warning" : "text-slate-100"}
      />
      <Stat label="Maintenance Requests" value={stats.maintenance_requests} sub="work orders" />
    </div>
  );
}
