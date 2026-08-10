from __future__ import annotations

import argparse
from pathlib import Path

from dotenv import load_dotenv

from .config import load_config
from .pipeline import judge_cost_estimate, run_judges, run_local_ab
from .plots import plot_dashboard


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Requirement classifier A/B benchmark")
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--output-dir", default="reports/latest")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate-config")
    subparsers.add_parser("estimate-judge-cost")
    subparsers.add_parser("local-ab")
    judge = subparsers.add_parser("judge-ab")
    judge.add_argument("--local-report", default="reports/latest/local_ab.json")
    judge.add_argument(
        "--resume-report",
        help="Reuse matching classifier/prediction/judge rows from an earlier judge report",
    )
    judge.add_argument(
        "--confirm-paid-api",
        action="store_true",
        help="Required acknowledgement that OpenAI judge calls incur cost",
    )
    all_run = subparsers.add_parser("all")
    all_run.add_argument("--confirm-paid-api", action="store_true")
    plot = subparsers.add_parser("plot-report")
    plot.add_argument("--local-report", default="reports/latest/local_ab.json")
    plot.add_argument("--judge-report", default="reports/latest/judge_ab.json")
    plot.add_argument("--plot-dir", default="reports/latest/plots")
    return parser


def main() -> None:
    load_dotenv()
    args = _parser().parse_args()
    config = load_config(args.config)
    output_dir = Path(args.output_dir).resolve()
    if args.command == "validate-config":
        print("Configuration is valid.")
        return
    if args.command == "estimate-judge-cost":
        import json

        print(json.dumps(judge_cost_estimate(config), indent=2))
        return
    if args.command == "local-ab":
        print(run_local_ab(config, output_dir))
        return
    if args.command == "plot-report":
        outputs = plot_dashboard(
            Path(args.local_report).resolve(),
            Path(args.judge_report).resolve(),
            Path(args.plot_dir).resolve(),
        )
        for output in outputs:
            print(output)
        return
    if not args.confirm_paid_api:
        raise SystemExit("Refusing paid judge calls: pass --confirm-paid-api after reviewing config")
    if args.command == "judge-ab":
        resume_report = Path(args.resume_report).resolve() if args.resume_report else None
        print(run_judges(config, Path(args.local_report).resolve(), output_dir, resume_report))
        return
    local_report = run_local_ab(config, output_dir)
    print(local_report)
    print(run_judges(config, local_report, output_dir))


if __name__ == "__main__":
    main()
