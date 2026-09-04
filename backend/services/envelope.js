/**
 * Rule-based safe-operating-envelope guard - a hard limit-alarm layer that runs
 * alongside the ML model. Real condition-monitoring systems pair a learned risk
 * score with deterministic limit alarms; this catches gross out-of-range
 * readings the AI4I classifier can't see (e.g. an over-temperature on a
 * temperature-only device such as an ECG or spectrometer).
 *
 * Each breached sensor contributes a severity in [0,1] that ramps from the soft
 * limit (0) to the hard limit (~0.97). The final effective risk is
 * max(ml_probability, envelope_severity), so a genuine limit breach forces at
 * least Warning/Critical even when the ML model is blind to that failure mode.
 */

// [soft, hard] limits per side. Beyond `hard`, severity saturates near 1.
const LIMITS = {
  process_temperature: { high: [313.5, 319], unit: "K", label: "process temperature" },
  air_temperature: { high: [304.5, 307], unit: "K", label: "air temperature" },
  torque: { high: [74, 85], low: [3, 1], unit: "Nm", label: "torque" },
  rotational_speed: { high: [2850, 3100], low: [1150, 1000], unit: "rpm", label: "rotational speed" },
  tool_wear: { high: [240, 262], unit: "min", label: "tool wear" },
};

function sideSeverity(value, soft, hard) {
  const span = hard - soft;
  if (span === 0) return 0;
  const frac = (value - soft) / span; // 0 at soft, 1 at hard (sign handles low side)
  const s = Math.max(0, Math.min(1.05, frac));
  return Math.min(0.97, s * 0.97);
}

export function envelopeCheck(readings) {
  const breaches = [];
  let severity = 0;

  for (const [feat, lim] of Object.entries(LIMITS)) {
    const v = readings[feat];
    if (v === null || v === undefined) continue;

    if (lim.high) {
      const [soft, hard] = lim.high;
      if (v > soft) {
        const s = sideSeverity(v, soft, hard);
        severity = Math.max(severity, s);
        breaches.push({
          feature: feat,
          label: lim.label,
          value: Math.round(v * 100) / 100,
          limit: soft,
          unit: lim.unit,
          direction: "high",
          severity: Math.round(s * 100) / 100,
        });
      }
    }
    if (lim.low) {
      const [soft, hard] = lim.low; // soft > hard on the low side
      if (v < soft) {
        const s = sideSeverity(-v, -soft, -hard);
        severity = Math.max(severity, s);
        breaches.push({
          feature: feat,
          label: lim.label,
          value: Math.round(v * 100) / 100,
          limit: soft,
          unit: lim.unit,
          direction: "low",
          severity: Math.round(s * 100) / 100,
        });
      }
    }
  }

  breaches.sort((a, b) => b.severity - a.severity);
  return { severity: Math.round(severity * 1000) / 1000, breaches };
}
