"""Command-line demo runner (no server, no browser needed).

Examples:
  python run_demo.py --all
  python run_demo.py SCI-DEV-001 v2.4 v2.5
  python run_demo.py QC-MODEL-07 v1 v2-drift --json out.json
"""

import argparse
import json

import pipeline


def _print(result):
    print()
    print(result["report"]["report_text"])
    print()
    print("Agent summary:")
    print("  " + result["agent"]["natural_language_summary"])
    if result["agent"]["recommended_investigation"]:
        print("Investigate:")
        for item in result["agent"]["recommended_investigation"]:
            print("  - " + item)
    if result["alert"]:
        print(f"ALERT ({result['alert']['severity']}) -> {result['alert']['responsible_role']} "
              f"via {result['alert']['channel']}")
    print("-" * 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("instrument", nargs="?")
    ap.add_argument("baseline", nargs="?")
    ap.add_argument("candidate", nargs="?")
    ap.add_argument("--trials", type=int, default=None)
    ap.add_argument("--all", action="store_true", help="run every demo validation")
    ap.add_argument("--json", help="write the full JSON result to this path")
    args = ap.parse_args()

    if args.all:
        for v in pipeline.list_validations():
            res = pipeline.run_validation(v["instrument"], v["baseline"], v["candidate"], args.trials)
            _print(res)
        return

    if not (args.instrument and args.baseline and args.candidate):
        ap.error("provide INSTRUMENT BASELINE CANDIDATE, or --all")

    res = pipeline.run_validation(args.instrument, args.baseline, args.candidate, args.trials)
    _print(res)
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(res, fh, indent=2)
        print("wrote", args.json)


if __name__ == "__main__":
    main()
