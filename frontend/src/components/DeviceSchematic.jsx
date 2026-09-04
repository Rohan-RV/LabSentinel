import { fmtFeature } from "../api";

// Per-type 2D component layouts. Each component lists the sensors that indicate
// its health, so a failing sensor lights up the exact part it belongs to.
const SCHEMATICS = {
  "Ventilator": [
    { label: "Air intake", sensors: [] },
    { label: "Blower motor", sensors: ["rotational_speed", "torque"] },
    { label: "Heat exchanger", sensors: ["process_temperature"] },
    { label: "Patient circuit", sensors: [] },
  ],
  "MRI Scanner": [
    { label: "Air cooling", sensors: ["air_temperature"] },
    { label: "Cold head", sensors: ["process_temperature"] },
    { label: "Gantry drive", sensors: ["rotational_speed"] },
    { label: "Scanner bore", sensors: [] },
  ],
  "Infusion Pump": [
    { label: "Reservoir", sensors: [] },
    { label: "Drive motor", sensors: ["rotational_speed", "torque"] },
    { label: "Occlusion bearing", sensors: ["torque"] },
    { label: "Delivery line", sensors: [] },
  ],
  "ECG Machine": [
    { label: "Leads", sensors: [] },
    { label: "Signal board", sensors: ["process_temperature"] },
    { label: "Display", sensors: [] },
  ],
  "Centrifuge": [
    { label: "Drive motor", sensors: ["rotational_speed"] },
    { label: "Drive belt", sensors: ["torque"] },
    { label: "Rotor bearing", sensors: ["tool_wear", "torque"] },
    { label: "Rotor", sensors: ["rotational_speed"] },
  ],
  "Spectrometer": [
    { label: "Lamp source", sensors: ["air_temperature"] },
    { label: "Optics", sensors: [] },
    { label: "Detector", sensors: ["process_temperature"] },
  ],
  "PCR Thermocycler": [
    { label: "Thermal block", sensors: ["process_temperature"] },
    { label: "Heating element", sensors: ["air_temperature", "tool_wear"] },
    { label: "Heated lid", sensors: [] },
  ],
  "HPLC Chromatograph": [
    { label: "Solvent pump", sensors: ["rotational_speed", "torque"] },
    { label: "Column heater", sensors: ["process_temperature"] },
    { label: "Detector", sensors: [] },
  ],
};

const U = { air_temperature: "K", process_temperature: "K", rotational_speed: "rpm", torque: "Nm", tool_wear: "min" };
const SHORT = { air_temperature: "air T", process_temperature: "proc T", rotational_speed: "speed", torque: "torque", tool_wear: "wear" };
const C = {
  ok: { fill: "#0f2a1b", stroke: "#22c55e", text: "#7fe0a3" },
  warn: { fill: "#2a2410", stroke: "#f59e0b", text: "#f4c76a" },
  fault: { fill: "#2a1414", stroke: "#ef4444", text: "#f19a9a" },
  passive: { fill: "#161d2e", stroke: "#2a3550", text: "#8091a0" },
};

export default function DeviceSchematic({ device }) {
  const comps = SCHEMATICS[device.type] || [{ label: device.type, sensors: device.reports || [] }];
  const readings = (device.lastReading && device.lastReading.readings) || {};
  const affected = new Set();
  (device.top_factors || []).forEach((f) => { if (f.direction === "raises_risk") affected.add(f.feature); });
  (device.envelope_breaches || []).forEach((b) => affected.add(b.feature));

  function stateOf(sensors) {
    if (!sensors.length) return "passive";
    if (sensors.some((s) => affected.has(s))) return "fault";
    if (device.status === "Warning") return "warn";
    return "ok";
  }

  const W = 124, H = 74, GAP = 40, X0 = 22, ROW = 46;
  const vbW = X0 * 2 + comps.length * W + (comps.length - 1) * GAP;
  const vbH = 168;

  const faults = comps.filter((c) => stateOf(c.sensors) === "fault");
  const faultSensors = [...affected].map(fmtFeature);
  const caption = faults.length
    ? `Fault localised to ${faults.map((c) => c.label).join(", ")} (driven by ${faultSensors.join(", ")})`
    : "All monitored components nominal";

  return (
    <div>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} width="100%" style={{ maxHeight: 220 }}>
        <defs>
          <marker id="schArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#516074" />
          </marker>
        </defs>
        <rect x="8" y="14" width={vbW - 16} height={vbH - 40} rx="12" fill="none" stroke="#2a3550" strokeWidth="1.5" />
        <text x="20" y="30" fontSize="11" fontWeight="700" fill="#8091a0">
          {device.type} · internal components
        </text>

        {comps.map((c, i) => {
          const x = X0 + i * (W + GAP);
          const st = stateOf(c.sensors);
          const col = C[st];
          const owned = c.sensors.filter((s) => readings[s] !== null && readings[s] !== undefined);
          return (
            <g key={i}>
              {i < comps.length - 1 && (
                <line x1={x + W} y1={ROW + H / 2} x2={x + W + GAP} y2={ROW + H / 2}
                  stroke="#516074" strokeWidth="2" markerEnd="url(#schArrow)" />
              )}
              <rect x={x} y={ROW} width={W} height={H} rx="10" fill={col.fill} stroke={col.stroke} strokeWidth={st === "fault" ? 3 : 1.6}>
                {st === "fault" && (
                  <animate attributeName="stroke-opacity" values="1;0.3;1" dur="1.3s" repeatCount="indefinite" />
                )}
              </rect>
              {st === "fault" && <text x={x + W - 12} y={ROW + 18} fontSize="14">⚠</text>}
              <text x={x + W / 2} y={ROW + 22} textAnchor="middle" fontSize="11.5" fontWeight="700" fill={col.text}>
                {c.label}
              </text>
              {owned.map((s, j) => (
                <text key={s} x={x + W / 2} y={ROW + 40 + j * 15} textAnchor="middle" fontSize="10" fill={col.text} fontFamily="ui-monospace, monospace">
                  {SHORT[s]} {readings[s]}{U[s]}
                </text>
              ))}
              {!c.sensors.length && (
                <text x={x + W / 2} y={ROW + 42} textAnchor="middle" fontSize="9" fill="#66748a">not monitored</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className={`mt-1 text-xs font-medium ${faults.length ? "text-critical" : "text-healthy"}`}>
        {caption}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-slate-500">
        <span><span style={{ color: C.ok.stroke }}>■</span> nominal</span>
        <span><span style={{ color: C.warn.stroke }}>■</span> warning</span>
        <span><span style={{ color: C.fault.stroke }}>■</span> affected</span>
        <span><span style={{ color: C.passive.stroke }}>■</span> not monitored</span>
      </div>
    </div>
  );
}
