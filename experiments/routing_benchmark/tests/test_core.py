import json
from pathlib import Path

import numpy as np

from routing_benchmark import operational_replay
from routing_benchmark.config import load_config
from routing_benchmark.dataset import (
    DIRECT_TOOL_FIXTURES,
    HUMAN_ORCHESTRATION_INDICES,
    REACT_ORCHESTRATION_INDICES,
    SIMPLE_SUPRA_INDICES,
    SUPERVISOR_FIXTURES,
)
from routing_benchmark.distribution_shift import _expected_calibration_error, _risk_coverage
from routing_benchmark.judges import aggregate_verdicts
from routing_benchmark.metrics import exact_mcnemar, routing_metrics
from routing_benchmark.routers import LLMRouteDecision, calculate_cost
from routing_benchmark.synthetic_data import SyntheticBatch, _near_duplicate, _normalize
from routing_benchmark.tables import export_tables


def test_config_has_five_routes() -> None:
    config = load_config(Path(__file__).parents[1] / "config.json")
    assert len(config.routes) == 5
    assert config.router_b["model_id"] == "gpt-5.6-luna"
    assert len(config.judges["models"]) == 3
    assert config.router_b["model_id"] not in config.judges["models"]


def test_direct_tool_fixtures_are_unique() -> None:
    assert len(DIRECT_TOOL_FIXTURES) == 10
    assert len(set(DIRECT_TOOL_FIXTURES)) == 10


def test_synthetic_data_normalization_and_deduplication() -> None:
    assert _normalize(" 견적을 계산해 주세요! ") == "견적을 계산해 주세요"
    assert _near_duplicate("견적을 계산해 주세요", ["견적을 계산해 주세요!"])
    schema = SyntheticBatch.model_json_schema()
    assert schema["additionalProperties"] is False


def test_korean_supervisor_fixtures_are_not_mojibake() -> None:
    korean_prompts = [
        prompt for prompt in SUPERVISOR_FIXTURES if any("가" <= char <= "힣" for char in prompt)
    ]
    assert len(korean_prompts) == 5
    assert all("?좉" not in prompt and "怨" not in prompt for prompt in korean_prompts)


def test_reviewed_gold_set_is_balanced_and_unique() -> None:
    groups = [
        DIRECT_TOOL_FIXTURES,
        SIMPLE_SUPRA_INDICES,
        REACT_ORCHESTRATION_INDICES,
        SUPERVISOR_FIXTURES,
        HUMAN_ORCHESTRATION_INDICES,
    ]
    assert all(len(group) == 10 for group in groups)
    assert all(len(set(group)) == 10 for group in groups)


def test_metrics_and_mcnemar() -> None:
    labels = ["A", "B"]
    truth = ["A", "A", "B", "B"]
    first = ["A", "B", "A", "B"]
    second = truth
    assert routing_metrics(truth, second, labels)["accuracy"] == 1.0
    result = exact_mcnemar(truth, first, second)
    assert result["b_only_correct"] == 2


def test_llm_schema_is_strict() -> None:
    schema = LLMRouteDecision.model_json_schema()
    assert schema["additionalProperties"] is False
    assert sorted(schema["required"]) == sorted(LLMRouteDecision.model_fields)


def test_cost_and_judge_aggregation() -> None:
    pricing = {"models": {"m": {"input": 1.0, "output": 2.0}}}
    assert calculate_cost("m", 1_000_000, 500_000, pricing) == 2.0
    verdicts = [
        {
            "judge_model": "judge-a",
            "route_score": 4,
            "groundedness_score": 4,
            "hallucination_detected": False,
        },
        {
            "judge_model": "judge-b",
            "route_score": 3,
            "groundedness_score": 3,
            "hallucination_detected": False,
        },
        {
            "judge_model": "judge-c",
            "route_score": 1,
            "groundedness_score": 1,
            "hallucination_detected": True,
        },
    ]
    assert aggregate_verdicts(verdicts, 3)["route_pass"] is True


def test_pandas_tables_export_numeric_summaries(tmp_path: Path) -> None:
    report = {
        "routes": {"SIMPLE_LLM": "single call"},
        "routers": [
            {
                "name": "router",
                "model_id": "model",
                "metrics": {
                    "accuracy": 1.0,
                    "macro_f1": 1.0,
                    "mean_ms": 10.0,
                    "p50_ms": 10.0,
                    "p95_ms": 10.0,
                    "throughput_per_second": 100.0,
                    "total_cost_usd": 0.01,
                    "per_route": {
                        "SIMPLE_LLM": {
                            "precision": 1.0,
                            "recall": 1.0,
                            "f1-score": 1.0,
                            "support": 1,
                        }
                    },
                },
                "predictions": [{"route": "SIMPLE_LLM"}],
            }
        ],
        "ab_test": {"p_value": 1.0},
    }
    report_path = tmp_path / "router_ab.json"
    report_path.write_text(json.dumps(report), encoding="utf-8")

    outputs = export_tables(report_path, None, tmp_path / "tables")

    assert {path.name for path in outputs} == {
        "router_summary.csv",
        "per_route_metrics.csv",
        "pandas_summary.json",
    }


def test_trusted_contract_route_uses_only_product_fixture_contracts() -> None:
    assert operational_replay._trusted_contract_route({"id": "direct_tool-project-1"}) == "DIRECT_TOOL"
    assert operational_replay._trusted_contract_route({"id": "supervisor-project-1"}) == "SUPERVISOR"
    assert operational_replay._trusted_contract_route({"id": "human-orchestration-1"}) is None


def test_report_source_path_does_not_leak_local_absolute_path() -> None:
    path = Path("C:/Users/example/project/experiments/routing_benchmark/report.json")

    assert operational_replay._portable_path(path) == "experiments/routing_benchmark/report.json"


def test_threshold_calibration_rejects_false_automation() -> None:
    probabilities = np.asarray([[0.90, 0.10], [0.85, 0.15], [0.80, 0.20], [0.75, 0.25], [0.70, 0.30], [0.95, 0.05]])
    truth = ["SIMPLE_LLM"] * 5 + ["HUMAN_REQUIRED"]

    thresholds = operational_replay._calibrate_thresholds(truth, ["SIMPLE_LLM", "HUMAN_REQUIRED"], probabilities)

    assert "SIMPLE_LLM" not in thresholds
    assert thresholds["HUMAN_REQUIRED"] == 0.0


def test_expected_calibration_error_is_zero_for_perfect_confidence() -> None:
    truth = ["A", "B"]
    predictions = ["A", "B"]

    assert _expected_calibration_error(truth, predictions, np.asarray([1.0, 1.0])) == 0.0


def test_risk_coverage_reduces_coverage_as_threshold_rises() -> None:
    rows = [
        {"confidence": 0.9, "correct": True, "expected": "A", "predicted": "A"},
        {"confidence": 0.4, "correct": False, "expected": "HUMAN_REQUIRED", "predicted": "A"}
    ]

    points = _risk_coverage(rows)

    assert points[0]["coverage"] == 1.0
    assert points[-1]["coverage"] == 0.5
    assert points[-1]["false_automation_count"] == 0.0
