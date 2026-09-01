from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

from .collection_planning import plan_collection
from .collector_capacity import evaluate_collector_capacity
from .config import load_config
from .distribution_shift import evaluate_distribution_shift
from .operational_replay import evaluate_operational_replay
from .pipeline import build_dataset_report, run_judges, run_router_ab
from .plots import create_plots
from .review_canary_power import evaluate_review_canary_power
from .review_canary_sequential import evaluate_review_canary_sequential
from .review_claim_capacity import evaluate_review_claim_capacity
from .review_consensus import evaluate_review_consensus
from .review_consensus_robustness import evaluate_consensus_robustness
from .review_export_capacity import evaluate_review_export_capacity
from .review_sampling import evaluate_review_sampling
from .review_sampling_bias import evaluate_review_sampling_bias
from .shadow_collection import prepare_shadow_export_pages, prepare_shadow_traces
from .shadow_evaluation import build_policy_replay_fixture, evaluate_shadow_traces
from .synthetic_data import generate_training_data
from .tables import export_tables
from .training import train_router_a


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent execution router A/B benchmark")
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--output-dir", default="reports/latest")

    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("validate-config")
    commands.add_parser("build-dataset")

    generate = commands.add_parser("generate-training-data")
    generate.add_argument("--confirm-paid-api", action="store_true")
    commands.add_parser("train-router-a")

    route = commands.add_parser("route-ab")
    route.add_argument("--confirm-paid-api", action="store_true")
    route.add_argument("--cached-router-b-report")

    judge = commands.add_parser("judge-ab")
    judge.add_argument("--ab-report", default="reports/latest/router_ab.json")
    judge.add_argument("--confirm-paid-api", action="store_true")

    plot = commands.add_parser("plot-report")
    plot.add_argument("--ab-report", default="reports/latest/router_ab.json")
    plot.add_argument("--judge-report")
    plot.add_argument("--plot-dir", default="reports/latest/plots")

    replay = commands.add_parser("operational-replay")
    replay.add_argument("--ab-report", default="reports/2026-08-11-a1-vs-luna/router_ab.json")
    replay.add_argument("--hybrid-report", default="reports/2026-08-13-hybrid-rrf/hybrid_router_evaluation.json")
    replay.add_argument("--train", default="../../agent/resources/routing/examples.jsonl")
    replay.add_argument("--validation", default="data/generated-v1/validation.jsonl")

    shift = commands.add_parser("distribution-shift")
    shift.add_argument("--ab-report", default="reports/2026-08-11-a1-vs-luna/router_ab.json")
    shift.add_argument("--train", default="../../agent/resources/routing/examples.jsonl")
    shift.add_argument("--validation", default="data/generated-v1/validation.jsonl")

    shadow_fixture = commands.add_parser("shadow-fixture")
    shadow_fixture.add_argument("--ab-report", default="reports/2026-08-11-a1-vs-luna/router_ab.json")
    shadow_fixture.add_argument("--shift-report", default="reports/2026-08-27-distribution-shift/distribution_shift_evaluation.json")
    shadow_fixture.add_argument("--trace-output", default="reports/latest/shadow_trace_fixture.jsonl")

    shadow = commands.add_parser("shadow-evaluate")
    shadow.add_argument("--traces", required=True)
    shadow.add_argument("--holdout-percent", type=int, default=20)

    shadow_prepare = commands.add_parser("shadow-prepare")
    shadow_prepare.add_argument("--observations", required=True)
    shadow_prepare.add_argument("--reviews", required=True)
    shadow_prepare.add_argument("--trace-output", required=True)
    shadow_prepare.add_argument("--hash-key-env", default="ROUTING_SHADOW_HASH_KEY")
    shadow_prepare.add_argument("--hash-key-version-env", default="ROUTING_SHADOW_HASH_KEY_VERSION")

    shadow_export_prepare = commands.add_parser("shadow-export-prepare")
    shadow_export_prepare.add_argument("--pages", required=True)
    shadow_export_prepare.add_argument("--trace-output", required=True)
    shadow_export_prepare.add_argument("--hash-key-env", default="ROUTING_SHADOW_HASH_KEY")
    shadow_export_prepare.add_argument("--hash-key-version-env", default="ROUTING_SHADOW_HASH_KEY_VERSION")

    collection_plan = commands.add_parser("collection-plan")
    collection_plan.add_argument("--trials", type=int, default=2_000)
    collection_plan.add_argument("--seed", type=int, default=20260827)

    review_sampling = commands.add_parser("review-sampling")
    review_sampling.add_argument("--trials", type=int, default=2_000)
    review_sampling.add_argument("--seed", type=int, default=20260827)

    commands.add_parser("collector-capacity")

    review_claim = commands.add_parser("review-claim-capacity")
    review_claim.add_argument("--trials", type=int, default=500)
    review_claim.add_argument("--seed", type=int, default=20260827)

    review_consensus = commands.add_parser("review-consensus")
    review_consensus.add_argument("--trials", type=int, default=5_000)
    review_consensus.add_argument("--seed", type=int, default=20260827)

    consensus_robustness = commands.add_parser("review-consensus-robustness")
    consensus_robustness.add_argument("--trials", type=int, default=5_000)
    consensus_robustness.add_argument("--seed", type=int, default=20260827)

    canary_power = commands.add_parser("review-canary-power")
    canary_power.add_argument("--trials", type=int, default=5_000)
    canary_power.add_argument("--seed", type=int, default=20260827)

    canary_sequential = commands.add_parser("review-canary-sequential")
    canary_sequential.add_argument("--trials", type=int, default=20_000)
    canary_sequential.add_argument("--seed", type=int, default=20260827)

    sampling_bias = commands.add_parser("review-sampling-bias")
    sampling_bias.add_argument("--trials", type=int, default=2_000)
    sampling_bias.add_argument("--seed", type=int, default=20260827)

    export_capacity = commands.add_parser("review-export-capacity")
    export_capacity.add_argument("--trials", type=int, default=2_000)
    export_capacity.add_argument("--seed", type=int, default=20260827)

    all_run = commands.add_parser("all")
    all_run.add_argument("--confirm-paid-api", action="store_true")
    all_run.add_argument("--cached-router-b-report")

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

    if args.command == "generate-training-data":
        if not args.confirm_paid_api:
            raise SystemExit("Paid API calls require --confirm-paid-api")
        print(generate_training_data(config))
        return

    if args.command == "train-router-a":
        print(train_router_a(config))
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

    if args.command == "operational-replay":
        outputs = evaluate_operational_replay(Path(args.ab_report).resolve(), Path(args.hybrid_report).resolve(), Path(args.train).resolve(), Path(args.validation).resolve(), output_dir)
        for output in outputs:
            print(output)
        return

    if args.command == "distribution-shift":
        outputs = evaluate_distribution_shift(Path(args.ab_report).resolve(), Path(args.train).resolve(), Path(args.validation).resolve(), output_dir)
        for output in outputs:
            print(output)
        return

    if args.command == "shadow-fixture":
        print(build_policy_replay_fixture(Path(args.ab_report).resolve(), Path(args.shift_report).resolve(), Path(args.trace_output).resolve()))
        return

    if args.command == "shadow-evaluate":
        for output in evaluate_shadow_traces(Path(args.traces).resolve(), output_dir, args.holdout_percent):
            print(output)
        return

    if args.command == "shadow-prepare":
        hash_key = os.getenv(args.hash_key_env)
        if hash_key is None:
            raise SystemExit(f"missing HMAC key environment variable: {args.hash_key_env}")
        hash_key_version = os.getenv(args.hash_key_version_env)
        if hash_key_version is None:
            raise SystemExit(f"missing HMAC key version environment variable: {args.hash_key_version_env}")
        for output in prepare_shadow_traces(Path(args.observations).resolve(), Path(args.reviews).resolve(), Path(args.trace_output).resolve(), hash_key, hash_key_version):
            print(output)
        return

    if args.command == "shadow-export-prepare":
        hash_key = os.getenv(args.hash_key_env)
        if hash_key is None:
            raise SystemExit(f"missing HMAC key environment variable: {args.hash_key_env}")
        hash_key_version = os.getenv(args.hash_key_version_env)
        if hash_key_version is None:
            raise SystemExit(f"missing HMAC key version environment variable: {args.hash_key_version_env}")
        for output in prepare_shadow_export_pages(Path(args.pages).resolve(), Path(args.trace_output).resolve(), hash_key, hash_key_version):
            print(output)
        return

    if args.command == "collection-plan":
        for output in plan_collection(output_dir, args.trials, args.seed):
            print(output)
        return

    if args.command == "review-sampling":
        for output in evaluate_review_sampling(output_dir, args.trials, args.seed):
            print(output)
        return

    if args.command == "collector-capacity":
        for output in evaluate_collector_capacity(output_dir):
            print(output)
        return

    if args.command == "review-claim-capacity":
        for output in evaluate_review_claim_capacity(output_dir, args.trials, args.seed):
            print(output)
        return

    if args.command == "review-consensus":
        for output in evaluate_review_consensus(output_dir, args.trials, args.seed):
            print(output)
        return

    if args.command == "review-consensus-robustness":
        for output in evaluate_consensus_robustness(output_dir, args.trials, args.seed):
            print(output)
        return

    if args.command == "review-canary-power":
        for output in evaluate_review_canary_power(output_dir, args.trials, args.seed):
            print(output)
        return

    if args.command == "review-canary-sequential":
        for output in evaluate_review_canary_sequential(output_dir, args.trials, args.seed):
            print(output)
        return

    if args.command == "review-sampling-bias":
        for output in evaluate_review_sampling_bias(output_dir, args.trials, args.seed):
            print(output)
        return

    if args.command == "review-export-capacity":
        for output in evaluate_review_export_capacity(output_dir, args.trials, args.seed):
            print(output)
        return

    if not args.confirm_paid_api:
        raise SystemExit("Paid API calls require --confirm-paid-api")

    if args.command == "route-ab":
        cached_b = (
            Path(args.cached_router_b_report).resolve() if args.cached_router_b_report else None
        )
        ab_report = run_router_ab(config, output_dir, cached_b)
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

    cached_b = Path(args.cached_router_b_report).resolve() if args.cached_router_b_report else None
    ab_report = run_router_ab(config, output_dir, cached_b)
    judge_report = run_judges(config, ab_report, output_dir)

    for output in create_plots(ab_report, judge_report, output_dir / "plots"):
        print(output)

    for output in export_tables(ab_report, judge_report, output_dir / "tables"):
        print(output)

    print(ab_report)
    print(judge_report)


if __name__ == "__main__":
    main()
