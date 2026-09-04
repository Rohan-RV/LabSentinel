/**
 * Live RUL projection: estimate time-to-Critical from the recent HEALTH trend.
 * This is an honest projection (labelled as such in the UI), separate from the
 * C-MAPSS RUL model which is benchmarked offline on real run-to-failure data.
 *
 * Health-aware: a device already in the critical floor is "imminent", not
 * "stable" (a flat-low trend is a failed device, not a healthy one). Only a
 * clearly sustained decline yields a countdown.
 */
export function projectRul(history) {
  if (!history || history.length < 4) return { status: "warming_up" };
  const pts = history.slice(-8);
  const t0 = new Date(pts[0].t).getTime();
  const xs = pts.map((p) => (new Date(p.t).getTime() - t0) / 1000);
  const ys = pts.map((p) => p.health);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den ? num / den : 0; // health points per second (negative = declining)
  const rounded = Math.round(slope * 1000) / 1000;
  const current = ys[n - 1];
  if (current <= 42) return { status: "imminent", slope: rounded };
  if (slope >= -0.15) return { status: "stable", slope: rounded };
  const eta = (current - 40) / -slope;
  if (eta > 1800) return { status: "stable", slope: rounded };
  return { status: "declining", eta_seconds: Math.round(eta), to: "Critical", slope: rounded };
}
