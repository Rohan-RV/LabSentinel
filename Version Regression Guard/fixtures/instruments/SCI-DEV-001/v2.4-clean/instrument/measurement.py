"""Measurement module.

Takes a single pressure reading from a sample, applying calibration.
Sensor noise is simulated deterministically from the trial seed so that
V1 and V2 see IDENTICAL raw draws in a given trial. Any output difference
between versions is therefore attributable to code, not to luck.
"""

import random

from instrument import calibration

# Physical sensor noise characteristics of this instrument. These are a
# property of the hardware, identical across software versions.
NOISE_SD = 0.15


def _draw_raw(sample, rng):
    base = sample["raw_pressure"]
    return base + rng.gauss(0.0, NOISE_SD)


def measure(sample, rng):
    """Return one calibrated pressure reading for the sample."""
    raw = _draw_raw(sample, rng)
    return calibration.calculate_pressure(raw)
