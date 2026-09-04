"""Shared device roster - the single source of truth for the LabSentinel fleet.

Reads model/config/device_types.json and deterministically builds ~38 device
instances. Running this module writes model/config/instances.json so the Node
backend consumes exactly the same roster the Python simulator uses.
"""
import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.join(HERE, "config")

ID_PREFIX = {
    "Ventilator": "VENT",
    "MRI Scanner": "MRI",
    "Infusion Pump": "PUMP",
    "ECG Machine": "ECG",
    "Centrifuge": "CENT",
    "Spectrometer": "SPEC",
    "PCR Thermocycler": "PCR",
    "HPLC Chromatograph": "HPLC",
}

LOCATIONS = {
    "Ventilator": ["ICU-A", "ICU-B", "ER", "COVID Ward", "Recovery", "ICU-C"],
    "MRI Scanner": ["Radiology-1", "Radiology-2", "Neuro Imaging", "Outpatient"],
    "Infusion Pump": ["Oncology", "ICU-A", "Pediatrics", "ER", "Surgery", "Ward-3"],
    "ECG Machine": ["Cardiology", "ER", "ICU-B", "Outpatient", "Ward-2"],
    "Centrifuge": ["Lab-Hematology", "Lab-Chem", "Blood Bank", "Research-1", "Research-2"],
    "Spectrometer": ["Lab-Chem", "Toxicology", "Research-1", "Pharmacy"],
    "PCR Thermocycler": ["Microbiology", "Genomics", "Research-2", "Virology"],
    "HPLC Chromatograph": ["Lab-Chem", "Pharmacology", "Toxicology", "QC Lab"],
}


def load_config():
    with open(os.path.join(CONFIG_DIR, "device_types.json"), "r", encoding="utf-8") as f:
        return json.load(f)


# A few instances are pinned for demo punch: the hero failure devices carry a
# live dependent load and no hot spare, so their Impact priority reads Critical.
# MRI-02 also has seeded cooling-system history for the memory-retrieval demo.
DEMO_OVERRIDES = {
    "VENT-01": {"active_dependents": 3, "backup_available": False},
    "MRI-02": {"active_dependents": 2, "backup_available": False},
    "CENT-01": {"active_dependents": 4, "backup_available": False},
}


def build_instances():
    """Deterministic fleet so Python and Node agree on IDs and baselines."""
    rng = random.Random(42)
    cfg = load_config()
    types = cfg["device_types"]
    instances = []

    for entry in cfg["fleet"]:
        dtype = entry["type"]
        spec = types[dtype]
        for i in range(1, entry["count"] + 1):
            dev_id = f"{ID_PREFIX[dtype]}-{i:02d}"
            baselines = {}
            for feat, params in spec["normal"].items():
                mean = params["mean"]
                if params.get("accumulates"):
                    # start each unit somewhere along its wear life
                    baselines[feat] = round(rng.uniform(20, mean + 40), 1)
                else:
                    # small per-instance offset so units aren't identical
                    jitter = rng.uniform(-1, 1) * max(params["std"], mean * 0.01)
                    baselines[feat] = round(mean + jitter, 2)

            crit = spec["criticality"]
            # dependents scale with how patient/experiment-facing the device is
            max_dep = {5: 3, 4: 3, 3: 5, 2: 4}.get(crit, 2)
            active_dependents = rng.randint(0, max_dep)
            # higher-criticality fleets more likely to keep a hot spare
            backup_available = rng.random() < (0.35 if crit >= 4 else 0.6)

            loc_list = LOCATIONS.get(dtype, ["Facility"])
            location = loc_list[(i - 1) % len(loc_list)]

            override = DEMO_OVERRIDES.get(dev_id, {})
            active_dependents = override.get("active_dependents", active_dependents)
            backup_available = override.get("backup_available", backup_available)

            instances.append({
                "id": dev_id,
                "type": dtype,
                "criticality": crit,
                "reports": spec["reports"],
                "baselines": baselines,
                "active_dependents": active_dependents,
                "backup_available": backup_available,
                "location": location,
            })

    return instances


def main():
    cfg = load_config()
    instances = build_instances()
    out = os.path.join(CONFIG_DIR, "instances.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({
            "feature_order": cfg["feature_order"],
            "feature_units": cfg["feature_units"],
            "device_types": cfg["device_types"],
            "instances": instances,
        }, f, indent=2)
    print(f"Wrote {len(instances)} device instances -> {out}")
    by_type = {}
    for d in instances:
        by_type[d["type"]] = by_type.get(d["type"], 0) + 1
    for t, c in by_type.items():
        print(f"  {t}: {c}")


if __name__ == "__main__":
    main()
