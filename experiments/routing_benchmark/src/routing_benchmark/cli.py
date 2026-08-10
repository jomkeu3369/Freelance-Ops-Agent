from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

from .config import load_config
from .pipeline import build_dataset_report, run_judges, run_router_ab
from .plots import create_plots
from .tables import export_tables


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent execution router A/B benchmark")
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--output-dir", default="reports/latest")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("validate-config")
    commands.add_parser("build-dataset")
    route = commands.add_parser("route-ab")
    route.add_argument("--confirm-paid-api", action="store_true")
    judge = commands.add_parser("judge-ab")
    judge.add_argument("--ab-report", default="reports/latest/router_ab.json")
    judge.add_argument("--confirm-paid-api", action="store_true")
    plot = commands.add_parser("plot-report")
    plot.add_argument("--ab-report", default="reports/latest/router_ab.json")
    plot.add_argument("--judge-report")
    plot.add_argument("--plot-dir", default="reports/latest/plots")
    all_run = commands.add_parser("all")
    all_run.add_argument("--confirm-paid-api", action="store_true")
    return parser


def main() -> None:
    load_dotenv()
    args = _parser().parse_args()
    config = load_config(args.config)
    os.environ["LANGSMITH_PROJECT"] = str(config.langsmith_project)
    output_dir = Path(args.output_dir).resolve()
    if args.command == "validate-config":
        print("Configuration is valid.")
        return
    if args.command == "build-dataset":
        print(build_dataset_report(config, output_dir))
        return
    if args.command == "plot-report":
        judge_report = Path(args.judge_report).resolve() if args.judge_report else None
        for output in create_plots(
            Path(args.ab_report).resolve(), judge_report, Path(args.plot_dir).resolve()
        ):
            print(output)
        for output in export_tables(
            Path(args.ab_report).resolve(), judge_report, Path(args.plot_dir).resolve().parent
        ):
            print(output)
        return
    if not args.confirm_paid_api:
        raise SystemExit("Paid API calls require --confirm-paid-api")
    if args.command == "route-ab":
        ab_report = run_router_ab(config, output_dir)
        for output in create_plots(ab_report, None, output_dir / "plots"):
            print(output)
        for output in export_tables(ab_report, None, output_dir / "tables"):
            print(output)
        print(ab_report)
        return
    if args.command == "judge-ab":
        judge_report = run_judges(config, Path(args.ab_report).resolve(), output_dir)
        for output in create_plots(
            Path(args.ab_report).resolve(), judge_report, output_dir / "plots"
        ):
            print(output)
        for output in export_tables(
            Path(args.ab_report).resolve(), judge_report, output_dir / "tables"
        ):
            print(output)
        print(judge_report)
        return
    ab_report = run_router_ab(config, output_dir)
    judge_report = run_judges(config, ab_report, output_dir)
    for output in create_plots(ab_report, judge_report, output_dir / "plots"):
        print(output)
    for output in export_tables(ab_report, judge_report, output_dir / "tables"):
        print(output)
    print(ab_report)
    print(judge_report)


if __name__ == "__main__":
    main()
