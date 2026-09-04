import { STATUS, PRIORITY } from "../api";

function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function AlertsPanel({ alerts, onOpen }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-ink-500/60 bg-ink-700/50">
      <div className="flex items-center justify-between border-b border-ink-500/60 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Alerts
        </h2>
        <span className="rounded-full bg-ink-500/70 px-2 py-0.5 text-xs text-slate-300">
          {alerts.length}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {alerts.length === 0 && (
          <div className="p-6 text-center text-sm text-slate-500">
            No active alerts. Fleet nominal.
          </div>
        )}
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => onOpen(a.device_id)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition hover:bg-ink-600/50 ${STATUS[a.status].soft}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">{a.device_id}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY[a.priority]}`}>
                    {a.priority}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-xs">
                  <span className={STATUS[a.status].text}>
                    {a.status} · {Math.round(a.failure_probability * 100)}% risk
                  </span>
                  <span className="text-slate-500">{timeAgo(a.timestamp)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">{a.reason}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
