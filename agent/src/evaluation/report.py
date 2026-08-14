"""Aggregate the V2 specification section 14.4 metrics without an LLM judge."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvaluationCase(StrictModel):
    case_id: str = Field(min_length=1, max_length=200)
    expected_relevant_ids: list[str] = Field(default_factory=list, max_length=100)
    retrieved_ids: list[str] = Field(default_factory=list, max_length=100)
    supported_citations: int | None = Field(default=None, ge=0)
    total_citations: int | None = Field(default=None, ge=0)
    cited_major_claims: int | None = Field(default=None, ge=0)
    total_major_claims: int | None = Field(default=None, ge=0)
    estimate_contains_actual: bool | None = None
    missing_items: int | None = Field(default=None, ge=0)
    expected_items: int | None = Field(default=None, ge=0)
    arithmetic_correct: bool | None = None
    high_risk_expected: bool | None = None
    high_risk_detected: bool | None = None
    normal_case: bool | None = None
    completed: bool | None = None
    expected_department: str | None = Field(default=None, max_length=100)
    predicted_department: str | None = Field(default=None, max_length=100)
    expected_route: str | None = Field(default=None, max_length=100)
    predicted_route: str | None = Field(default=None, max_length=100)
    abstained: bool | None = None
    used_fallback: bool | None = None
    loop_or_budget_exceeded: bool | None = None
    web_collection_succeeded: bool | None = None
    fresh_sources: int | None = Field(default=None, ge=0)
    collected_sources: int | None = Field(default=None, ge=0)
    variable_cost: float | None = Field(default=None, ge=0)
    sale_price: float | None = Field(default=None, ge=0)
    cross_tenant_attempt: bool | None = None
    cross_tenant_blocked: bool | None = None

    @model_validator(mode="after")
    def validate_paired_counts(self) -> EvaluationCase:
        pairs = (
            (self.supported_citations, self.total_citations, "citation"),
            (self.cited_major_claims, self.total_major_claims, "major claim"),
            (self.missing_items, self.expected_items, "quotation item"),
            (self.fresh_sources, self.collected_sources, "source freshness"),
        )
        for numerator, denominator, label in pairs:
            if (numerator is None) != (denominator is None):
                raise ValueError(f"{label} numerator and denominator must be supplied together")
            if numerator is not None and denominator is not None and numerator > denominator:
                raise ValueError(f"{label} numerator cannot exceed denominator")
        if (self.expected_route is None) != (self.predicted_route is None):
            raise ValueError("expected and predicted route must be supplied together")
        if (self.expected_department is None) != (self.predicted_department is None):
            raise ValueError("expected and predicted department must be supplied together")
        if self.high_risk_expected is not None and self.high_risk_detected is None:
            raise ValueError("risk detection result is required when risk expectation is supplied")
        if self.normal_case is not None and self.completed is None:
            raise ValueError("completion result is required when normal-case label is supplied")
        if self.cross_tenant_attempt is not None and self.cross_tenant_blocked is None:
            raise ValueError("cross-tenant block result is required when attempt label is supplied")
        return self


class MetricValue(StrictModel):
    value: float | None
    numerator: float | None = None
    denominator: int = Field(ge=0)
    ci95_low: float | None = None
    ci95_high: float | None = None


class EvaluationReport(StrictModel):
    schema_version: str = "v2-evaluation-report-1"
    dataset_version: str = Field(min_length=1, max_length=200)
    evaluated_at: datetime
    case_count: int = Field(ge=0)
    metrics: dict[str, MetricValue]
    route_recall: dict[str, MetricValue]


def build_evaluation_report(cases: list[EvaluationCase], *, dataset_version: str, evaluated_at: datetime) -> EvaluationReport:  # noqa: E501
    metrics = {
        "retrieval_recall_at_5": _mean([_recall_at_five(case) for case in cases]),
        "retrieval_mrr": _mean([_reciprocal_rank(case) for case in cases]),
        "citation_precision": _ratio_from_counts(cases, "supported_citations", "total_citations"),
        "major_claim_citation_coverage": _ratio_from_counts(cases, "cited_major_claims", "total_major_claims"),
        "estimate_range_coverage": _boolean_rate(case.estimate_contains_actual for case in cases),
        "quotation_item_omission_rate": _ratio_from_counts(cases, "missing_items", "expected_items"),
        "arithmetic_accuracy": _boolean_rate(case.arithmetic_correct for case in cases),
        "high_risk_recall": _boolean_rate(
            case.high_risk_detected for case in cases if case.high_risk_expected is True
        ),
        "normal_case_completion_rate": _boolean_rate(case.completed for case in cases if case.normal_case is True),
        "department_routing_accuracy": _boolean_rate(
            case.expected_department == case.predicted_department
            for case in cases
            if case.expected_department is not None
        ),
        "routing_macro_f1": _routing_macro_f1(cases),
        "human_required_miss_rate": _human_required_miss_rate(cases),
        "routing_abstain_rate": _boolean_rate(case.abstained for case in cases),
        "routing_fallback_rate": _boolean_rate(case.used_fallback for case in cases),
        "loop_or_budget_exceed_rate": _boolean_rate(case.loop_or_budget_exceeded for case in cases),
        "web_collection_success_rate": _boolean_rate(case.web_collection_succeeded for case in cases),
        "web_source_freshness_rate": _ratio_from_counts(cases, "fresh_sources", "collected_sources"),
        "successful_output_variable_cost_ratio": _cost_ratio(cases),
        "cross_tenant_block_rate": _boolean_rate(
            case.cross_tenant_blocked for case in cases if case.cross_tenant_attempt is True
        ),
    }
    return EvaluationReport(
        dataset_version=dataset_version,
        evaluated_at=evaluated_at,
        case_count=len(cases),
        metrics=metrics,
        route_recall=_route_recall(cases),
    )


def _recall_at_five(case: EvaluationCase) -> float | None:
    expected = set(case.expected_relevant_ids)
    if not expected:
        return None
    return len(expected.intersection(case.retrieved_ids[:5])) / len(expected)


def _reciprocal_rank(case: EvaluationCase) -> float | None:
    expected = set(case.expected_relevant_ids)
    if not expected:
        return None
    return next((1 / rank for rank, item in enumerate(case.retrieved_ids, start=1) if item in expected), 0.0)


def _ratio_from_counts(cases: list[EvaluationCase], numerator_field: str, denominator_field: str) -> MetricValue:
    numerator = 0
    denominator = 0
    for case in cases:
        case_numerator = getattr(case, numerator_field)
        case_denominator = getattr(case, denominator_field)
        if case_numerator is not None and case_denominator is not None:
            numerator += int(case_numerator)
            denominator += int(case_denominator)
    return _rate(numerator, denominator)


def _boolean_rate(values: Iterable[bool | None]) -> MetricValue:
    selected = [value for value in values if value is not None]
    return _rate(sum(bool(value) for value in selected), len(selected))


def _mean(values: list[float | None]) -> MetricValue:
    selected = [value for value in values if value is not None]
    return MetricValue(
        value=sum(selected) / len(selected) if selected else None,
        denominator=len(selected),
    )


def _routing_macro_f1(cases: list[EvaluationCase]) -> MetricValue:
    labeled = [(case.expected_route, case.predicted_route) for case in cases if case.expected_route is not None]
    labels = sorted({label for pair in labeled for label in pair if label is not None})
    f1_values: list[float] = []
    for label in labels:
        true_positive = sum(expected == label and predicted == label for expected, predicted in labeled)
        false_positive = sum(expected != label and predicted == label for expected, predicted in labeled)
        false_negative = sum(expected == label and predicted != label for expected, predicted in labeled)
        denominator = 2 * true_positive + false_positive + false_negative
        f1_values.append((2 * true_positive / denominator) if denominator else 0.0)
    return MetricValue(value=sum(f1_values) / len(f1_values) if f1_values else None, denominator=len(labeled))


def _route_recall(cases: list[EvaluationCase]) -> dict[str, MetricValue]:
    counts: dict[str, list[bool]] = defaultdict(list)
    for case in cases:
        if case.expected_route is not None:
            counts[case.expected_route].append(case.predicted_route == case.expected_route)
    return {label: _boolean_rate(values) for label, values in sorted(counts.items())}


def _human_required_miss_rate(cases: list[EvaluationCase]) -> MetricValue:
    expected = [case for case in cases if case.expected_route == "HUMAN_REQUIRED"]
    missed = sum(case.predicted_route != "HUMAN_REQUIRED" for case in expected)
    return _rate(missed, len(expected))


def _cost_ratio(cases: list[EvaluationCase]) -> MetricValue:
    eligible = [
        case for case in cases
        if case.completed is True
        and case.variable_cost is not None
        and case.sale_price is not None
        and case.sale_price > 0
    ]
    total_cost = sum(case.variable_cost or 0 for case in eligible)
    total_sales = sum(case.sale_price or 0 for case in eligible)
    return MetricValue(
        value=total_cost / total_sales if total_sales > 0 else None,
        numerator=total_cost if eligible else None,
        denominator=len(eligible),
    )


def _rate(numerator: int, denominator: int) -> MetricValue:
    if denominator == 0:
        return MetricValue(value=None, denominator=0)
    value = numerator / denominator
    low, high = _wilson_interval(numerator, denominator)
    return MetricValue(
        value=value,
        numerator=float(numerator),
        denominator=denominator,
        ci95_low=low,
        ci95_high=high,
    )


def _wilson_interval(numerator: int, denominator: int) -> tuple[float, float]:
    z = 1.959963984540054
    proportion = numerator / denominator
    scale = 1 + z * z / denominator
    center = (proportion + z * z / (2 * denominator)) / scale
    margin = z * math.sqrt(
        proportion * (1 - proportion) / denominator + z * z / (4 * denominator * denominator)
    ) / scale
    return max(0.0, center - margin), min(1.0, center + margin)
