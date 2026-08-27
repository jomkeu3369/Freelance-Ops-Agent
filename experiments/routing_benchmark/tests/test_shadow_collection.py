from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from routing_benchmark.shadow_collection import (
    RouteObservationExport,
    prepare_shadow_export_pages,
    prepare_shadow_traces,
)


def _observation(run_id: str, workspace_id: str, project_id: str, event_id: int = 3) -> dict[str, object]:
    return {
        "run_id": run_id,
        "event_id": event_id,
        "workspace_id": workspace_id,
        "project_id": project_id,
        "occurred_at": "2026-08-27T00:00:00Z",
        "route_data": {
            "route": "SIMPLE_LLM",
            "decisionSource": "LLM_EVALUATOR",
            "shadowSuggestedRoute": "HUMAN_REQUIRED",
            "shadowLatencyMs": 2.5,
            "routingLatencyMs": 100.0,
            "routingInputTokens": 100,
            "routingOutputTokens": 10
        },
        "routing_cost_usd": 0.001
    }


def test_observation_contract_rejects_prompt_text() -> None:
    payload = _observation(str(uuid4()), str(uuid4()), str(uuid4()))
    payload["route_data"]["prompt"] = "private request"  # type: ignore[index]
    with pytest.raises(ValidationError):
        RouteObservationExport.model_validate(payload)


def test_prepare_uses_keyed_hashes_and_writes_manifest(tmp_path: Path) -> None:
    run_id, workspace_id, project_id = str(uuid4()), str(uuid4()), str(uuid4())
    observations = tmp_path / "observations.jsonl"
    reviews = tmp_path / "reviews.jsonl"
    output = tmp_path / "shadow.jsonl"
    observations.write_text(json.dumps(_observation(run_id, workspace_id, project_id)) + "\n", encoding="utf-8")
    reviews.write_text(json.dumps({
        "run_id": run_id,
        "event_id": 3,
        "workspace_id": workspace_id,
        "gold_route": "HUMAN_REQUIRED",
        "correction_source": "HUMAN_REVIEW"
    }) + "\n", encoding="utf-8")

    trace_path, manifest_path = prepare_shadow_traces(observations, reviews, output, "k" * 32)

    trace = json.loads(trace_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert run_id not in trace_path.read_text(encoding="utf-8")
    assert workspace_id not in trace_path.read_text(encoding="utf-8")
    assert trace["final_route"] == "SIMPLE_LLM"
    assert trace["gold_route"] == "HUMAN_REQUIRED"
    assert trace["llm_called"] is True
    assert trace["schema_version"] == "1.1"
    assert trace["sampling_stratum"] == "risk"
    assert trace["review_inclusion_probability"] == 1.0
    assert trace["sample_weight"] == 1.0
    assert manifest["matched_count"] == 1
    assert manifest["population_strata"] == {"natural": 0, "risk": 1}
    assert manifest["output_sha256"]


def test_policy_gate_reason_code_becomes_policy_code(tmp_path: Path) -> None:
    run_id, workspace_id, project_id = str(uuid4()), str(uuid4()), str(uuid4())
    observation = _observation(run_id, workspace_id, project_id)
    observation["route_data"] = {
        "route": "DIRECT_TOOL",
        "decisionSource": "POLICY_GATE",
        "reasonCodes": ["TRUSTED_DIRECT_TOOL_OPERATION"],
        "routingLatencyMs": 0.1,
        "routingInputTokens": 0,
        "routingOutputTokens": 0
    }
    observations = tmp_path / "observations.jsonl"
    reviews = tmp_path / "reviews.jsonl"
    observations.write_text(json.dumps(observation), encoding="utf-8")
    reviews.write_text(json.dumps({
        "run_id": run_id,
        "event_id": 3,
        "workspace_id": workspace_id,
        "gold_route": "DIRECT_TOOL",
        "correction_source": "HUMAN_REVIEW"
    }), encoding="utf-8")

    output, _ = prepare_shadow_traces(observations, reviews, tmp_path / "output.jsonl", "k" * 32)

    trace = json.loads(output.read_text(encoding="utf-8"))
    assert trace["policy_code"] == "TRUSTED_DIRECT_TOOL_OPERATION"
    assert trace["llm_called"] is False


def test_prepare_records_inverse_inclusion_weights_for_oversampled_reviews(tmp_path: Path) -> None:
    workspace_id, project_id = str(uuid4()), str(uuid4())
    rows = []
    for index in range(10):
        observation = _observation(str(uuid4()), workspace_id, project_id, index + 1)
        if index < 9:
            observation["route_data"]["shadowSuggestedRoute"] = "SIMPLE_LLM"  # type: ignore[index]
        rows.append(observation)
    reviews = [
        {
            "run_id": rows[0]["run_id"], "event_id": 1, "workspace_id": workspace_id,
            "gold_route": "SIMPLE_LLM", "correction_source": "HUMAN_REVIEW"
        },
        {
            "run_id": rows[9]["run_id"], "event_id": 10, "workspace_id": workspace_id,
            "gold_route": "HUMAN_REQUIRED", "correction_source": "HUMAN_REVIEW"
        }
    ]
    observations_path = tmp_path / "observations.jsonl"
    reviews_path = tmp_path / "reviews.jsonl"
    observations_path.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
    reviews_path.write_text("\n".join(json.dumps(row) for row in reviews), encoding="utf-8")

    output, manifest_path = prepare_shadow_traces(observations_path, reviews_path, tmp_path / "weighted.jsonl", "k" * 32)

    traces = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    by_stratum = {trace["sampling_stratum"]: trace for trace in traces}
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert by_stratum["natural"]["population_stratum_probability"] == 0.9
    assert by_stratum["natural"]["review_inclusion_probability"] == pytest.approx(1 / 9)
    assert by_stratum["natural"]["sample_weight"] == pytest.approx(9)
    assert by_stratum["risk"]["population_stratum_probability"] == 0.1
    assert by_stratum["risk"]["sample_weight"] == 1
    assert manifest["reviewed_strata"] == {"natural": 1, "risk": 1}


def test_prepare_rejects_cross_workspace_review(tmp_path: Path) -> None:
    run_id, workspace_id, project_id = str(uuid4()), str(uuid4()), str(uuid4())
    observations = tmp_path / "observations.jsonl"
    reviews = tmp_path / "reviews.jsonl"
    observations.write_text(json.dumps(_observation(run_id, workspace_id, project_id)), encoding="utf-8")
    reviews.write_text(json.dumps({
        "run_id": run_id,
        "event_id": 3,
        "workspace_id": str(uuid4()),
        "gold_route": "SIMPLE_LLM",
        "correction_source": "HUMAN_REVIEW"
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="workspace"):
        prepare_shadow_traces(observations, reviews, tmp_path / "output.jsonl", "k" * 32)


def test_prepare_backend_export_pages_without_raw_intermediate_files(tmp_path: Path) -> None:
    run_id, workspace_id, project_id = str(uuid4()), str(uuid4()), str(uuid4())
    observation_id = str(uuid4())
    pricing_id = str(uuid4())
    page = {
        "since": "2026-08-26T00:00:00Z",
        "until": "2026-08-27T00:00:00Z",
        "snapshotAt": "2026-08-27T01:00:00Z",
        "observations": [{
            "observationId": observation_id,
            "runId": run_id,
            "eventId": 3,
            "workspaceId": workspace_id,
            "projectId": project_id,
            "occurredAt": "2026-08-26T12:00:00Z",
            "routeData": {
                "route": "SIMPLE_LLM",
                "decisionSource": "LLM_EVALUATOR",
                "evaluatorProvider": "OPENAI",
                "evaluatorModel": "gpt-5.6-luna",
                "routingLatencyMs": 100.0,
                "routingInputTokens": 100,
                "routingOutputTokens": 10
            },
            "routingCostUsd": 0.001,
            "pricingSnapshotId": pricing_id,
            "pricingVersion": "2026-08-27",
            "costCurrency": "USD"
        }],
        "reviews": [{
            "runId": run_id,
            "eventId": 3,
            "workspaceId": workspace_id,
            "goldRoute": "SIMPLE_LLM",
            "correctionSource": "HUMAN_REVIEW"
        }],
        "nextOccurredAt": "2026-08-26T12:00:00Z",
        "nextObservationId": observation_id,
        "hasMore": False
    }
    pages = tmp_path / "pages.jsonl"
    pages.write_text(json.dumps(page), encoding="utf-8")

    output, manifest_path = prepare_shadow_export_pages(
        pages, tmp_path / "traces.jsonl", "k" * 32, "pricing-test-v1"
    )

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert output.exists()
    assert manifest["schema_version"] == "1.1"
    assert manifest["pricing_snapshot_ids"] == [pricing_id]
    assert manifest["pricing_versions"] == ["2026-08-27"]
    assert manifest["cost_currency"] == "USD"
