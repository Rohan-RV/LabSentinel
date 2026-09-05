"""Calibration module.

v2.5 introduces an "adaptive" calibration that accepts a calibration_factor
and applies a correction term. This is the change under test: its interface
changed (a new parameter) AND its behavior changed (a correction term that
biases the mean and amplifies input variation).
"""

SLOPE = 1.0
OFFSET = 0.0
DEFAULT_CALIBRATION_FACTOR = 0.94

# Anchor point for the new adaptive correction term.
_CORRECTION_ANCHOR = 96.0
_CORRECTION_GAIN = 0.35


def calculate_pressure(raw_data, calibration_factor=DEFAULT_CALIBRATION_FACTOR):
    """Return the calibrated pressure for a single raw reading.

    v2.5 adaptive calibration:
        pressure = raw_data * SLOPE * calibration_factor + OFFSET
                   + (raw_data - anchor) * gain
    """
    corrected = raw_data * SLOPE * calibration_factor + OFFSET
    corrected += (raw_data - _CORRECTION_ANCHOR) * _CORRECTION_GAIN
    return corrected
