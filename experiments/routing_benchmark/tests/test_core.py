import json
from pathlib import Path

from routing_benchmark.config import load_config
from routing_benchmark.dataset import (
    DIRECT_TOOL_FIXTURES,
    HUMAN_ORCHESTRATION_INDICES,
    REACT_ORCHESTRATION_INDICES,
    SIMPLE_SUPRA_INDICES,
    SUPERVISOR_FIXTURES,
)
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
