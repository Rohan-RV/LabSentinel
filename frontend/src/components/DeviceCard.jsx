import { STATUS, PRIORITY, fmtRul } from "../api";

function HealthRing({ value, status }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  const color = STATUS[status].ring;
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" className="shrink-0">
      <circle cx="30" cy="30" r={r} fill="none" stroke="#2a3550" strokeWidth="6" />
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform="rotate(-90 30 30)"
        style={{ transition: "stroke-dashoffset 0.7s ease, stroke 0.4s" }}
      />
      <text x="30" y="34" textAnchor="middle" fontSize="15" fontWeight="700" fill="#e5e9f0">
        {value}
      </text>
    </svg>
  );
}

export default function DeviceCard({ device, onOpen }) {
  const st = STATUS[device.status];
  const crit = device.status === "Critical";
  const showPriority = device.status !== "Healthy";
  const conf = `${device.sensors_reported}/${device.sensors_expected} sensors`;
  const lowConf = device.sensors_reported < device.sensors_expected;
  const rul = fmtRul(device.rul);

  return (
    <button
      onClick={() => onOpen(device.id)}
      className={`group relative flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition
        ${crit ? "border-critical/60 bg-critical/5 pulse-critical" : "border-ink-500/60 bg-ink-700/60 hover:border-ink-500"}
      `}
    >
      <span className={`absolute left-0 top-3 h-[calc(100%-1.5rem)] w-1 rounded-r ${st.bg}`} />
      <HealthRing value={device.health} status={device.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-slate-100">{device.id}</span>
          {device.failing && (
            <span className="rounded bg-critical/20 px-1.5 py-0.5 text-[10px] font-semibold text-critical">
              RAMPING
            </span>
          )}
        </div>
        <div className="truncate text-xs text-slate-400">
          {device.type} · {device.location}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${st.soft} border`}>
            {device.status}
          </span>
          {showPriority && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY[device.impact.priority]}`}>
              {device.impact.priority} priority
            </span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              lowConf ? "bg-amber-500/10 text-amber-300" : "bg-ink-500/60 text-slate-400"
            }`}
            title="reporting sensors / expected sensors"
          >
            {conf}
          </span>
          {rul && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                rul.tone === "critical"
                  ? "bg-critical/10 text-critical"
                  : "bg-warning/10 text-warning"
              }`}
              title="Estimated time to failure, projected from the health trend"
            >
              {rul.text}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
