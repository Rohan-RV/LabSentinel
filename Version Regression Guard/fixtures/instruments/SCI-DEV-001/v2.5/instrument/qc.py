"""Quality-control workflow.

Sanity-checks a measured value against the instrument's operating window and
verifies a known control standard by pushing a reference raw reading back
through calibration. Because it uses calibration, QC is genuinely downstream
of any calibration change (the dependency graph will show this).
"""

from instrument import calibration

ACCEPTABLE_MIN = 90.0
ACCEPTABLE_MAX = 105.0

# A certified control standard: a known raw input that must calibrate to a
# known pressure within tolerance. This is how a lab detects a bad calibration.
CONTROL_RAW = 100.0
CONTROL_EXPECTED = 100.0
CONTROL_TOLERANCE = 1.0


def run_qc(measurement_value):
    in_range = ACCEPTABLE_MIN <= measurement_value <= ACCEPTABLE_MAX

    control_value = calibration.calculate_pressure(CONTROL_RAW)
    control_ok = abs(control_value - CONTROL_EXPECTED) <= CONTROL_TOLERANCE

    status = "in_range" if (in_range and control_ok) else "out_of_range"
    return {
        "status": status,
        "value_in_range": in_range,
        "control_ok": control_ok,
        "control_value": round(control_value, 4),
    }
