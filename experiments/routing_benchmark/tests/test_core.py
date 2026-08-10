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


def test_config_has_five_routes() -> None:
    config = load_config(Path(__file__).parents[1] / "config.json")
    assert len(config.routes) == 5


def test_direct_tool_fixtures_are_unique() -> None:
    assert len(DIRECT_TOOL_FIXTURES) == 10
    assert len(set(DIRECT_TOOL_FIXTURES)) == 10


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
        {"route_score": 4, "groundedness_score": 4, "hallucination_detected": False},
        {"route_score": 3, "groundedness_score": 3, "hallucination_detected": False},
        {"route_score": 1, "groundedness_score": 1, "hallucination_detected": True},
    ]
    assert aggregate_verdicts(verdicts, 3)["route_pass"] is True
