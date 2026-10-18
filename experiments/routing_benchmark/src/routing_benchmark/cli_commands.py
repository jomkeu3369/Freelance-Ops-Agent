from __future__ import annotations

import os
from pathlib import Path

from .collection_planning import plan_collection
from .collector_capacity import evaluate_collector_capacity
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

SIMULATION_COMMANDS = {
    "collection-plan": plan_collection,
    "review-sampling": evaluate_review_sampling,
    "review-claim-capacity": evaluate_review_claim_capacity,
    "review-consensus": evaluate_review_consensus,
    "review-consensus-robustness": evaluate_consensus_robustness,
    "review-canary-power": evaluate_review_canary_power,
    "review-canary-sequential": evaluate_review_canary_sequential,
    "review-sampling-bias": evaluate_review_sampling_bias,
    "review-export-capacity": evaluate_review_export_capacity,
}


def run_local_command(args, config, output_dir: Path) -> bool:
    if args.command == "validate-config":
        print("설정 검증을 통과했습니다.")
        return True

    if args.command == "build-dataset":
        print(build_dataset_report(config, output_dir))
        return True

    if args.command == "train-router-a":
        print(train_router_a(config))
        return True

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

        return True

    if args.command == "operational-replay":
        outputs = evaluate_operational_replay(
            Path(args.ab_report).resolve(),
            Path(args.hybrid_report).resolve(),
            Path(args.train).resolve(),
            Path(args.validation).resolve(),
            output_dir
        )
        for output in outputs:
            print(output)
        return True

    if args.command == "distribution-shift":
        outputs = evaluate_distribution_shift(
            Path(args.ab_report).resolve(),
            Path(args.train).resolve(),
            Path(args.validation).resolve(),
            output_dir
        )
        for output in outputs:
            print(output)
        return True

    if args.command == "shadow-fixture":
        print(
            build_policy_replay_fixture(
                Path(args.ab_report).resolve(),
                Path(args.shift_report).resolve(),
                Path(args.trace_output).resolve()
            )
        )
        return True

    if args.command == "shadow-evaluate":
        for output in evaluate_shadow_traces(
            Path(args.traces).resolve(), output_dir, args.holdout_percent
        ):
            print(output)
        return True

    if args.command == "shadow-prepare":
        hash_key = os.getenv(args.hash_key_env)
        if hash_key is None:
            raise SystemExit(f"missing HMAC key environment variable: {args.hash_key_env}")
        hash_key_version = os.getenv(args.hash_key_version_env)
        if hash_key_version is None:
            raise SystemExit(
                f"missing HMAC key version environment variable: {args.hash_key_version_env}"
            )
        for output in prepare_shadow_traces(
            Path(args.observations).resolve(),
            Path(args.reviews).resolve(),
            Path(args.trace_output).resolve(),
            hash_key,
            hash_key_version
        ):
            print(output)
        return True

    if args.command == "shadow-export-prepare":
        hash_key = os.getenv(args.hash_key_env)
        if hash_key is None:
            raise SystemExit(f"missing HMAC key environment variable: {args.hash_key_env}")
        hash_key_version = os.getenv(args.hash_key_version_env)
        if hash_key_version is None:
            raise SystemExit(
                f"missing HMAC key version environment variable: {args.hash_key_version_env}"
            )
        for output in prepare_shadow_export_pages(
            Path(args.pages).resolve(),
            Path(args.trace_output).resolve(),
            hash_key,
            hash_key_version
        ):
            print(output)
        return True

    if args.command == "collector-capacity":
        for output in evaluate_collector_capacity(output_dir):
            print(output)
        return True

    if args.command in SIMULATION_COMMANDS:
        for output in SIMULATION_COMMANDS[args.command](output_dir, args.trials, args.seed):
            print(output)
        return True

    return False


def run_paid_command(args, config, output_dir: Path) -> None:
    if not args.confirm_paid_api:
        raise SystemExit("유료 호출에는 --confirm-paid-api가 필요합니다.")

    if args.command == "generate-training-data":
        print(generate_training_data(config))
        return

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
