from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from routing_benchmark.shadow_evaluation import (
    ShadowTrace,
    _evaluate,
    _wilson,
    evaluate_shadow_traces,
)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _trace(index: int, group: str, gold: str = "HUMAN_REQUIRED") -> ShadowTrace:
    return ShadowTrace(
        trace_hash=_hash(f"trace-{index}"),
        workspace_group_hash=_hash(group),
        occurred_at=datetime(2026, 8, 27, tzinfo=UTC),
        final_route="HUMAN_REQUIRED",
        shadow_suggested_route="HUMAN_REQUIRED",
        gold_route=gold,
        correction_source="HUMAN_REVIEW",
        llm_called=True,
        routing_latency_ms=100,
        shadow_latency_ms=2,
        routing_cost_usd=0.01
    )


def test_schema_rejects_prompt_and_plain_identifiers() -> None:
    payload = _trace(1, "group").model_dump(mode="json")
    payload["prompt"] = "secret text"
    with pytest.raises(ValidationError):
        ShadowTrace.model_validate(payload)
    payload.pop("prompt")
    payload["workspace_group_hash"] = "customer-1"
    with pytest.raises(ValidationError):
        ShadowTrace.model_validate(payload)


def test_schema_rejects_inconsistent_sampling_weight() -> None:
    payload = _trace(1, "group").model_dump(mode="json")
    payload.update({
        "schema_version": "1.1",
        "sampling_stratum": "risk",
        "population_stratum_probability": 0.1,
        "review_inclusion_probability": 0.5,
        "sample_weight": 1.0
    })

    with pytest.raises(ValidationError, match="inverse"):
        ShadowTrace.model_validate(payload)


def test_post_stratification_restores_population_accuracy() -> None:
    natural = _trace(1, "natural", gold="HUMAN_REQUIRED").model_copy(update={
        "schema_version": "1.1",
        "sampling_stratum": "natural",
        "population_stratum_probability": 0.9,
        "review_inclusion_probability": 1 / 9,
        "sample_weight": 9.0
    })
    risk = _trace(2, "risk", gold="DIRECT_TOOL").model_copy(update={
        "schema_version": "1.1",
        "sampling_stratum": "risk",
        "population_stratum_probability": 0.1,
        "review_inclusion_probability": 1.0,
        "sample_weight": 1.0
    })

    metrics = _evaluate("weighted", "actual", [natural, risk])

    assert metrics["accuracy"] == pytest.approx(0.9)
    assert metrics["traffic_route_share"]["HUMAN_REQUIRED"] == pytest.approx(0.9)
    assert metrics["traffic_route_share"]["DIRECT_TOOL"] == pytest.approx(0.1)
    assert metrics["mean_routing_cost_usd"] == pytest.approx(0.01)


def test_wilson_interval_is_conservative_for_small_samples() -> None:
    interval = _wilson(10, 10)
    assert interval["estimate"] == 1.0
    assert 0.72 < interval["lower"] < 0.73


def test_grouped_holdout_and_outputs(tmp_path: Path) -> None:
    traces = [_trace(index, f"group-{index}") for index in range(50)]
    source = tmp_path / "traces.jsonl"
    source.write_text("\n".join(trace.model_dump_json() for trace in traces), encoding="utf-8")

    outputs = evaluate_shadow_traces(source, tmp_path / "report", holdout_percent=50)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    holdout_hashes = set(report["split"]["holdout_trace_hashes"])
    assert holdout_hashes
    assert report["split"]["holdout_samples"] < 50
    assert report["promotion_gate"]["eligible"] is False
    assert report["promotion_gate"]["checks"]["minimum_effective_samples_1000"] is False
    assert report["promotion_gate"]["checks"]["post_stratification_available"] is False
    groups_by_partition: dict[bool, set[str]] = {True: set(), False: set()}
    for trace in traces:
        groups_by_partition[trace.trace_hash in holdout_hashes].add(trace.workspace_group_hash)
    assert groups_by_partition[True].isdisjoint(groups_by_partition[False])
