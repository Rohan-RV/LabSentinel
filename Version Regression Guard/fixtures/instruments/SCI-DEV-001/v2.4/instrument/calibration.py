"""Calibration module.

Converts a raw sensor reading into a calibrated pressure value.
This is the component that changes in v2.5, so it is the focus of the demo.
"""

SLOPE = 1.0
OFFSET = 0.0


def calculate_pressure(raw_data):
    """Return the calibrated pressure for a single raw reading.

    v2.4 uses a simple, validated linear calibration:
        pressure = raw_data * SLOPE + OFFSET
    """
    return raw_data * SLOPE + OFFSET
