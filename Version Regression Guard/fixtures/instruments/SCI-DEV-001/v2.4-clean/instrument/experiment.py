"""Experiment workflow.

Runs several replicate measurements and reports the mean pressure plus a
repeatability percentage. Repeatability is the metric most sensitive to a
bad calibration change, which is exactly what the demo exercises.
"""

import statistics

from instrument import measurement


def run_experiment(sample, rng):
    replicates = sample.get("replicates", 8)
    values = [measurement.measure(sample, rng) for _ in range(replicates)]

    mean_pressure = statistics.fmean(values)
    stdev = statistics.pstdev(values) if len(values) > 1 else 0.0

    # Repeatability: 100% means every replicate landed on the same value.
    # Larger spread (relative to the mean) drives this down.
    repeatability_pct = 100.0 * (1.0 - (stdev / mean_pressure)) if mean_pressure else 0.0

    return {
        "measurement_value": round(mean_pressure, 4),
        "repeatability_pct": round(repeatability_pct, 4),
        "replicates": replicates,
    }
