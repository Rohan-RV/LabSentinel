"""Calibration module.

Converts a raw sensor reading into a calibrated pressure value.

v2.4.1 is a maintenance release: this file is documented and tidied but the
calibration math is byte-for-byte equivalent to v2.4. It exists to show a
GREEN (safe) validation next to the RED (regressed) v2.5 candidate.
"""

# Linear calibration constants (unchanged since v2.4).
SLOPE = 1.0
OFFSET = 0.0


def calculate_pressure(raw_data):
    """Return the calibrated pressure for a single raw reading.

    Validated linear calibration, identical to v2.4:
        pressure = raw_data * SLOPE + OFFSET
    """
    calibrated_pressure = raw_data * SLOPE + OFFSET
    return calibrated_pressure
