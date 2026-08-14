from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from evaluation import EvaluationCase, build_evaluation_report
from evaluation.__main__ import _load_cases


def cases() -> list[EvaluationCase]:
    return [
        EvaluationCase(
            case_id="case-1",
            expected_relevant_ids=["a", "b"],
            retrieved_ids=["x", "a", "b"],
            supported_citations=2,
            total_citations=2,
            cited_major_claims=3,
            total_major_claims=4,
            estimate_contains_actual=True,
            missing_items=1,
            expected_items=5,
            arithmetic_correct=True,
            high_risk_expected=True,
            high_risk_detected=True,
            normal_case=False,
            completed=True,
            expected_department="RESEARCH",
            predicted_department="RESEARCH",
            expected_route="HUMAN_REQUIRED",
            predicted_route="HUMAN_REQUIRED",
            abstained=False,
            used_fallback=True,
            loop_or_budget_exceeded=False,
            web_collection_succeeded=True,
            fresh_sources=2,
            collected_sources=2,
            variable_cost=10,
            sale_price=100,
            cross_tenant_attempt=True,
            cross_tenant_blocked=True,
        ),
        EvaluationCase(
            case_id="case-2",
            expected_relevant_ids=["c"],
            retrieved_ids=["z"],
            supported_citations=1,
            total_citations=2,
            cited_major_claims=1,
            total_major_claims=2,
            estimate_contains_actual=False,
            missing_items=0,
            expected_items=5,
            arithmetic_correct=True,
            high_risk_expected=False,
            high_risk_detected=False,
            normal_case=True,
            completed=True,
            expected_department="REQUIREMENTS",
            predicted_department="RESEARCH",
            expected_route="REACT_AGENT",
            predicted_route="SIMPLE_LLM",
            abstained=True,
            used_fallback=False,
            loop_or_budget_exceeded=False,
            web_collection_succeeded=False,
            fresh_sources=1,
            collected_sources=2,
            variable_cost=20,
            sale_price=100,
            cross_tenant_attempt=False,
            cross_tenant_blocked=False,
        ),
    ]


def test_builds_every_specification_metric_with_sample_sizes_and_intervals() -> None:
    report = build_evaluation_report(
        cases(),
        dataset_version="frozen-v1",
        evaluated_at=datetime(2026, 8, 14, tzinfo=UTC),
    )

    assert report.case_count == 2
    assert len(report.metrics) == 19
    assert report.metrics["retrieval_recall_at_5"].value == 0.5
    assert report.metrics["retrieval_mrr"].value == 0.25
    assert report.metrics["citation_precision"].value == 0.75
    assert report.metrics["major_claim_citation_coverage"].value == pytest.approx(4 / 6)
    assert report.metrics["quotation_item_omission_rate"].value == 0.1
    assert report.metrics["arithmetic_accuracy"].value == 1.0
    assert report.metrics["human_required_miss_rate"].value == 0.0
    assert report.metrics["successful_output_variable_cost_ratio"].value == 0.15
    assert report.metrics["cross_tenant_block_rate"].value == 1.0
    assert report.route_recall["HUMAN_REQUIRED"].value == 1.0
    assert report.metrics["citation_precision"].ci95_low is not None


def test_missing_measurements_are_null_instead_of_false_success() -> None:
    report = build_evaluation_report(
        [EvaluationCase(case_id="empty")],
        dataset_version="empty-v1",
        evaluated_at=datetime(2026, 8, 14, tzinfo=UTC),
    )

    assert report.metrics["citation_precision"].value is None
    assert report.metrics["citation_precision"].denominator == 0
    assert report.metrics["cross_tenant_block_rate"].value is None


def test_rejects_inconsistent_metric_denominators() -> None:
    with pytest.raises(ValidationError, match="citation numerator and denominator"):
        EvaluationCase(case_id="invalid", supported_citations=1)


def test_cli_loader_accepts_jsonl_without_silently_dropping_cases(tmp_path: Path) -> None:
    path = tmp_path / "cases.jsonl"
    path.write_text('{"case_id":"one"}\n{"case_id":"two"}\n', encoding="utf-8")

    loaded = _load_cases(path)

    assert [case.case_id for case in loaded] == ["one", "two"]
