"""Output contract for the instrument.

Downstream systems (LIMS, reporting) depend on these fields existing with
these names. AI Kavach checks that a candidate version keeps
the contract intact (data-integrity / output-format check).
"""

# The required output fields the instrument promises to emit per sample.
OUTPUT_SCHEMA = [
    "sample_id",
    "measurement_value",
    "repeatability_pct",
    "qc_status",
    "software_version",
]


def format_output(sample_id, experiment_result, qc_result, software_version):
    return {
        "sample_id": sample_id,
        "measurement_value": experiment_result["measurement_value"],
        "repeatability_pct": experiment_result["repeatability_pct"],
        "qc_status": qc_result["status"],
        "software_version": software_version,
    }
