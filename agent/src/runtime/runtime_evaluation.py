"""Fail-closed runtime predictor and scheduler promotion evaluation."""

# ruff: noqa: E501

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from statistics import mean
from uuid import UUID


class RuntimeReleaseStatus(StrEnum):
    SHADOW_ONLY = "SHADOW_ONLY"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


@dataclass(frozen=True, slots=True)
class TaskAttemptEvaluationRecord:
    attempt_id: UUID
    task_id: UUID
    workspace_id: UUID
    attempt_number: int
    priority: int
    resource_pool: str
    queued_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    predicted_runtime_seconds: float | None
    predictor_version: str | None
    succeeded: bool
    retry_reason: str | None = None

    def __post_init__(self) -> None:
        if self.attempt_number < 1 or not 1 <= self.priority <= 5 or not self.resource_pool.strip():
            raise ValueError("runtime evaluation record identity is invalid")
        for value in (self.queued_at, self.started_at, self.finished_at):
            if value is not None and (value.tzinfo is None or value.utcoffset() is None):
                raise ValueError("runtime evaluation timestamps must be timezone-aware")
        if self.predicted_runtime_seconds is not None and self.predicted_runtime_seconds < 0:
            raise ValueError("runtime prediction must be non-negative")

    @property
    def complete(self) -> bool:
        return self.queued_at is not None and self.started_at is not None and self.finished_at is not None and self.queued_at <= self.started_at <= self.finished_at

    @property
    def runtime_seconds(self) -> float | None:
        return None if not self.complete else (self.finished_at - self.started_at).total_seconds()  # type: ignore[operator]

    @property
    def wait_seconds(self) -> float | None:
        return None if not self.complete else (self.started_at - self.queued_at).total_seconds()  # type: ignore[operator]

    @property
    def completion_seconds(self) -> float | None:
        return None if not self.complete else (self.finished_at - self.queued_at).total_seconds()  # type: ignore[operator]


@dataclass(frozen=True, slots=True)
class RuntimeEvaluationPolicy:
    policy_version: str = "runtime-promotion-v1"
    minimum_attempts: int = 1_000
    minimum_observation_days: int = 7
    minimum_load_bands: int = 3
    minimum_prediction_coverage: float = 0.95
    minimum_retry_reason_coverage: float = 0.99
    maximum_mae_seconds: float = 6
    maximum_p95_absolute_error_seconds: float = 15
    minimum_r2: float = 0.80
    minimum_completion_goodput: float = 0.95
    minimum_priority_wait_goodput: float = 0.95
    minimum_worst_workspace_goodput: float = 0.90
    minimum_workspace_fairness: float = 0.90
    maximum_wait_seconds: float = 300
    completion_slo_seconds: float = 300
    priority_wait_slo_seconds: float = 60


@dataclass(frozen=True, slots=True)
class RuntimeGate:
    name: str
    passed: bool
    actual: float
    threshold: str


@dataclass(frozen=True, slots=True)
class PredictorEvaluationMetrics:
    coverage: float
    version_coverage: float
    mae_seconds: float
    p95_absolute_error_seconds: float
    r2: float


@dataclass(frozen=True, slots=True)
class SchedulerEvaluationMetrics:
    completion_goodput: float
    priority_wait_goodput: float
    worst_workspace_goodput: float
    workspace_fairness: float
    maximum_wait_seconds: float


@dataclass(frozen=True, slots=True)
class RuntimeEvaluationReport:
    status: RuntimeReleaseStatus
    policy_version: str
    record_count: int
    observation_days: float
    load_band_count: int
    required_field_missing_count: int
    scheduler_observation_coverage: float
    retry_reason_coverage: float
    predictor: PredictorEvaluationMetrics
    observed_scheduler: SchedulerEvaluationMetrics
    shadow_scheduler: SchedulerEvaluationMetrics | None
    gates: tuple[RuntimeGate, ...]


def evaluate_runtime_release(records: list[TaskAttemptEvaluationRecord], *, load_band_count: int, source_terminal_count: int | None = None, shadow_scheduler: SchedulerEvaluationMetrics | None = None, policy: RuntimeEvaluationPolicy | None = None) -> RuntimeEvaluationReport:
    selected = policy or RuntimeEvaluationPolicy()
    total_terminal = len(records) if source_terminal_count is None else source_terminal_count
    if not records or load_band_count < 0 or total_terminal < len(records):
        raise ValueError("runtime evaluation requires records and a non-negative load band count")
    complete = [record for record in records if record.complete]
    timestamps = [record.queued_at for record in complete if record.queued_at is not None]
    observation_days = 0.0 if not timestamps else (max(timestamps) - min(timestamps)).total_seconds() / 86_400
    missing_count = len(records) - len(complete)
    predictions = [record for record in complete if record.predicted_runtime_seconds is not None]
    coverage = len(predictions) / len(records)
    version_coverage = 0.0 if not predictions else sum(record.predictor_version is not None and bool(record.predictor_version.strip()) for record in predictions) / len(predictions)
    errors = [abs(_prediction(record) - _runtime(record)) for record in predictions]
    actual = [_runtime(record) for record in predictions]
    mae = 0.0 if not errors else mean(errors)
    p95_error = _percentile(errors, 95)
    r2 = _r2(actual, [_prediction(record) for record in predictions])
    predictor = PredictorEvaluationMetrics(coverage, version_coverage, mae, p95_error, r2)
    retries = [record for record in records if record.attempt_number > 1]
    retry_coverage = 1.0 if not retries else sum(record.retry_reason is not None and bool(record.retry_reason.strip()) for record in retries) / len(retries)
    scheduler_coverage = len(records) / total_terminal
    observed = _scheduler_metrics(complete, selected)
    gates = [
        RuntimeGate("minimum_attempts", len(records) >= selected.minimum_attempts, float(len(records)), f">= {selected.minimum_attempts}"),
        RuntimeGate("minimum_observation_days", observation_days >= selected.minimum_observation_days, observation_days, f">= {selected.minimum_observation_days}"),
        RuntimeGate("minimum_load_bands", load_band_count >= selected.minimum_load_bands, float(load_band_count), f">= {selected.minimum_load_bands}"),
        RuntimeGate("required_field_missing_count", missing_count == 0, float(missing_count), "= 0"),
        RuntimeGate("scheduler_observation_coverage", scheduler_coverage == 1, scheduler_coverage, "= 1.0"),
        RuntimeGate("prediction_coverage", coverage >= selected.minimum_prediction_coverage, coverage, f">= {selected.minimum_prediction_coverage}"),
        RuntimeGate("predictor_version_coverage", version_coverage == 1, version_coverage, "= 1.0"),
        RuntimeGate("retry_reason_coverage", retry_coverage >= selected.minimum_retry_reason_coverage, retry_coverage, f">= {selected.minimum_retry_reason_coverage}"),
        RuntimeGate("predictor_mae_seconds", mae <= selected.maximum_mae_seconds, mae, f"<= {selected.maximum_mae_seconds}"),
        RuntimeGate("predictor_p95_absolute_error_seconds", p95_error <= selected.maximum_p95_absolute_error_seconds, p95_error, f"<= {selected.maximum_p95_absolute_error_seconds}"),
        RuntimeGate("predictor_r2", r2 >= selected.minimum_r2, r2, f">= {selected.minimum_r2}"),
        RuntimeGate("shadow_metrics_available", shadow_scheduler is not None, 0.0 if shadow_scheduler is None else 1.0, "= 1.0")
    ]
    if shadow_scheduler is not None:
        gates.extend(_scheduler_gates(shadow_scheduler, selected))
    status = RuntimeReleaseStatus.APPROVED if all(gate.passed for gate in gates) else RuntimeReleaseStatus.SHADOW_ONLY
    return RuntimeEvaluationReport(status, selected.policy_version, len(records), observation_days, load_band_count, missing_count, scheduler_coverage, retry_coverage, predictor, observed, shadow_scheduler, tuple(gates))


def _scheduler_metrics(records: list[TaskAttemptEvaluationRecord], policy: RuntimeEvaluationPolicy) -> SchedulerEvaluationMetrics:
    if not records:
        return SchedulerEvaluationMetrics(0, 0, 0, 0, math.inf)
    completion_goodput = sum(record.succeeded and _completion(record) <= policy.completion_slo_seconds for record in records) / len(records)
    priority = [record for record in records if record.priority >= 4]
    priority_goodput = 1.0 if not priority else sum(_wait(record) <= policy.priority_wait_slo_seconds for record in priority) / len(priority)
    grouped: dict[UUID, list[TaskAttemptEvaluationRecord]] = defaultdict(list)
    for record in records:
        grouped[record.workspace_id].append(record)
    workspace_rates = [sum(record.succeeded and _completion(record) <= policy.completion_slo_seconds for record in values) / len(values) for values in grouped.values()]
    return SchedulerEvaluationMetrics(completion_goodput, priority_goodput, min(workspace_rates), _jain(workspace_rates), max(_wait(record) for record in records))


def _scheduler_gates(metrics: SchedulerEvaluationMetrics, policy: RuntimeEvaluationPolicy) -> list[RuntimeGate]:
    return [RuntimeGate("shadow_completion_goodput", metrics.completion_goodput >= policy.minimum_completion_goodput, metrics.completion_goodput, f">= {policy.minimum_completion_goodput}"), RuntimeGate("shadow_priority_wait_goodput", metrics.priority_wait_goodput >= policy.minimum_priority_wait_goodput, metrics.priority_wait_goodput, f">= {policy.minimum_priority_wait_goodput}"), RuntimeGate("shadow_worst_workspace_goodput", metrics.worst_workspace_goodput >= policy.minimum_worst_workspace_goodput, metrics.worst_workspace_goodput, f">= {policy.minimum_worst_workspace_goodput}"), RuntimeGate("shadow_workspace_fairness", metrics.workspace_fairness >= policy.minimum_workspace_fairness, metrics.workspace_fairness, f">= {policy.minimum_workspace_fairness}"), RuntimeGate("shadow_maximum_wait_seconds", metrics.maximum_wait_seconds <= policy.maximum_wait_seconds, metrics.maximum_wait_seconds, f"<= {policy.maximum_wait_seconds}")]


def _prediction(record: TaskAttemptEvaluationRecord) -> float:
    assert record.predicted_runtime_seconds is not None
    return record.predicted_runtime_seconds


def _runtime(record: TaskAttemptEvaluationRecord) -> float:
    assert record.runtime_seconds is not None
    return record.runtime_seconds


def _wait(record: TaskAttemptEvaluationRecord) -> float:
    assert record.wait_seconds is not None
    return record.wait_seconds


def _completion(record: TaskAttemptEvaluationRecord) -> float:
    assert record.completion_seconds is not None
    return record.completion_seconds


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return math.inf
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile / 100
    lower = math.floor(position)
    upper = math.ceil(position)
    return ordered[lower] if lower == upper else ordered[lower] * (upper - position) + ordered[upper] * (position - lower)


def _r2(actual: list[float], predicted: list[float]) -> float:
    if len(actual) < 2:
        return -math.inf
    average = mean(actual)
    total = sum((value - average) ** 2 for value in actual)
    return -math.inf if total == 0 else 1 - sum((left - right) ** 2 for left, right in zip(actual, predicted, strict=True)) / total


def _jain(values: list[float]) -> float:
    denominator = len(values) * sum(value * value for value in values)
    return 0.0 if denominator == 0 else sum(values) ** 2 / denominator
