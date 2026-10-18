from __future__ import annotations

import argparse


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="요청별 실행 경로 선택 모델과 정책 비교")
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
    replay.add_argument(
        "--hybrid-report", default="reports/2026-08-13-hybrid-rrf/hybrid_router_evaluation.json"
    )
    replay.add_argument("--train", default="../../agent/resources/routing/examples.jsonl")
    replay.add_argument("--validation", default="data/generated-v1/validation.jsonl")

    shift = commands.add_parser("distribution-shift")
    shift.add_argument("--ab-report", default="reports/2026-08-11-a1-vs-luna/router_ab.json")
    shift.add_argument("--train", default="../../agent/resources/routing/examples.jsonl")
    shift.add_argument("--validation", default="data/generated-v1/validation.jsonl")

    shadow_fixture = commands.add_parser("shadow-fixture")
    shadow_fixture.add_argument(
        "--ab-report", default="reports/2026-08-11-a1-vs-luna/router_ab.json"
    )
    shadow_fixture.add_argument(
        "--shift-report",
        default="reports/2026-08-27-distribution-shift/distribution_shift_evaluation.json"
    )
    shadow_fixture.add_argument(
        "--trace-output", default="reports/latest/shadow_trace_fixture.jsonl"
    )

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
    shadow_export_prepare.add_argument(
        "--hash-key-version-env", default="ROUTING_SHADOW_HASH_KEY_VERSION"
    )

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
