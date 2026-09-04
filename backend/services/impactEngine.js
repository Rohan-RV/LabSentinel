/**
 * Phase 5 - Impact Engine. A rule-based layer that runs AFTER prediction and
 * converts raw failure risk into operational priority, so a 70%-risk ventilator
 * with a patient on it outranks a 90%-risk idle ECG.
 *
 *   raw = failure_probability * criticality * (1 + active_dependents)
 *             * (backup_available ? 0.5 : 1)
 *   priority = normalize(raw) -> Low / Medium / High / Critical
 */

// Max raw = 1 * 5 * (1 + maxDependents) * 1. With maxDependents = 5 -> 30.
const MAX_RAW = 1 * 5 * 6 * 1;

export function computeImpact({
  failure_probability,
  criticality = 3,
  active_dependents = 0,
  backup_available = false,
}) {
  const raw =
    failure_probability *
    criticality *
    (1 + active_dependents) *
    (backup_available ? 0.5 : 1);

  const score = Math.max(0, Math.min(1, raw / MAX_RAW));

  let priority;
  if (score >= 0.5) priority = "Critical";
  else if (score >= 0.28) priority = "High";
  else if (score >= 0.12) priority = "Medium";
  else priority = "Low";

  return {
    priority,
    impact_score: Math.round(score * 1000) / 1000,
    raw: Math.round(raw * 100) / 100,
    factors: {
      failure_probability,
      criticality,
      active_dependents,
      backup_available,
    },
  };
}

// Numeric rank for sorting alerts (higher = more urgent).
export const PRIORITY_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 };
