"""Isolated runner for the code arm of the digital twin.

Invoked as a subprocess so each software version is imported in its OWN Python
process. Both versions ship a package called `instrument`; running them in
separate processes is what lets us load V1 and V2 without their modules
colliding in one interpreter. It reads a JSON job on stdin and prints the
observed runs as JSON on stdout. This is the "controlled, safe testing
environment": the candidate code runs sandboxed, never against a real
instrument.

stdin JSON: {"version_dir": ..., "entry": "pkg.mod:func",
             "samples": [...], "trials": N}
"""

import importlib
import json
import sys


def main():
    job = json.load(sys.stdin)
    sys.path.insert(0, job["version_dir"])

    mod_name, func_name = job["entry"].split(":")
    module = importlib.import_module(mod_name)
    run_all = getattr(module, func_name)

    runs = []
    for trial in range(job["trials"]):
        for sample in job["samples"]:
            seed = 1000 + trial  # same seed for every version in a given trial
            try:
                result = run_all(sample, seed)
                result["_trial"] = trial
                runs.append(result)
            except Exception as exc:  # a version that crashes is itself a signal
                runs.append({
                    "sample_id": sample.get("id"),
                    "_trial": trial,
                    "_crashed": True,
                    "error": f"{type(exc).__name__}: {exc}",
                    "workflows": {},
                    "output_fields": [],
                    "error_count": 1,
                    "warning_count": 0,
                    "processing_ms": 0.0,
                })

    print(json.dumps({"runs": runs}))


if __name__ == "__main__":
    main()
