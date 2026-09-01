from __future__ import annotations

import json
import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from statistics import mean
from typing import Any

from .scheduler_simulation import SchedulerTask, SchedulingPolicy, _jain_index, _percentile, simulate_scheduler


SHADOW_REPLAY_SCHEMA_VERSION = "scheduler-shadow-replay-v1"


class ValidationLevel(StrEnum):
    ERROR = "error"
    WARNING = "warning"


class ReplaySource(StrEnum):
    OBSERVED = "observed"
    COUNTERFACTUAL = "counterfactual"


@dataclass(frozen=True, slots=True)
class ShadowTaskAttempt:
    schema_version: str
    attempt_id: str
    task_id: str
    attempt_number: int
    workspace_id: str
    task_type: str
    model: str
    input_tokens: int
    context_tokens: int
    file_count: int
    subagent_depth: int
    priority: int
    queued_at: datetime
    started_at: datetime
    completed_at: datetime
    feature_snapshot_at: datetime
    predicted_at: datetime
    predicted_runtime_seconds: float
    predictor_version: str
    runtime_seconds: float
    success: bool
    cache_hit: bool = False
    workspace_weight: float = 1.0
    retry_reason: str | None = None
    checkpoint_restored_seconds: float = 0.0
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @property
    def queue_wait_seconds(self) -> float:
        return (self.started_at - self.queued_at).total_seconds()

    @property
    def completion_seconds(self) -> float:
        return (self.completed_at - self.queued_at).total_seconds()


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    level: ValidationLevel
    attempt_id: str | None
    message: str


@dataclass(frozen=True, slots=True)
class ShadowReplayValidationReport:
    record_count: int
    error_count: int
    warning_count: int
    maximum_observed_concurrency: int
    retry_attempt_rate: float
    checkpoint_resume_rate: float
    issues: tuple[ValidationIssue, ...]

    @property
    def is_valid(self) -> bool:
        return self.error_count == 0


class ShadowReplayValidationError(ValueError):
    def __init__(self, report: ShadowReplayValidationReport) -> None:
        self.report = report
        messages = "; ".join(issue.message for issue in report.issues if issue.level is ValidationLevel.ERROR)
        super().__init__(messages or "shadow replay validation failed")


@dataclass(frozen=True, slots=True)
class ReplayMetrics:
    task_count: int
    success_rate: float
    completion_slo_rate: float
    mean_wait_seconds: float
    p95_wait_seconds: float
    maximum_wait_seconds: float
    mean_completion_seconds: float
    p95_completion_seconds: float
    fairness_index: float


@dataclass(frozen=True, slots=True)
class ReplayPolicyResult:
    name: str
    source: ReplaySource
    metrics: ReplayMetrics


@dataclass(frozen=True, slots=True)
class ShadowReplayResult:
    validation: ShadowReplayValidationReport
    worker_count: int
    completion_slo_seconds: float
    results: tuple[ReplayPolicyResult, ...]


def _parse_datetime(value: object, field_name: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be an ISO-8601 string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone offset")
    return parsed.astimezone(UTC)


def shadow_attempt_from_mapping(value: Mapping[str, Any]) -> ShadowTaskAttempt:
    required = ("schema_version", "attempt_id", "task_id", "attempt_number", "workspace_id", "task_type", "model", "input_tokens", "context_tokens", "file_count", "subagent_depth", "priority", "queued_at", "started_at", "completed_at", "feature_snapshot_at", "predicted_at", "predicted_runtime_seconds", "predictor_version", "runtime_seconds", "success")
    missing = [name for name in required if name not in value]
    if missing:
        raise ValueError(f"missing required shadow replay fields: {', '.join(missing)}")
    metadata = value.get("metadata", {})
    if not isinstance(metadata, Mapping):
        raise ValueError("metadata must be an object")
    if not isinstance(value["success"], bool) or not isinstance(value.get("cache_hit", False), bool):
        raise ValueError("success and cache_hit must be booleans")
    return ShadowTaskAttempt(schema_version=str(value["schema_version"]), attempt_id=str(value["attempt_id"]), task_id=str(value["task_id"]), attempt_number=int(value["attempt_number"]), workspace_id=str(value["workspace_id"]), task_type=str(value["task_type"]), model=str(value["model"]), input_tokens=int(value["input_tokens"]), context_tokens=int(value["context_tokens"]), file_count=int(value["file_count"]), subagent_depth=int(value["subagent_depth"]), priority=int(value["priority"]), queued_at=_parse_datetime(value["queued_at"], "queued_at"), started_at=_parse_datetime(value["started_at"], "started_at"), completed_at=_parse_datetime(value["completed_at"], "completed_at"), feature_snapshot_at=_parse_datetime(value["feature_snapshot_at"], "feature_snapshot_at"), predicted_at=_parse_datetime(value["predicted_at"], "predicted_at"), predicted_runtime_seconds=float(value["predicted_runtime_seconds"]), predictor_version=str(value["predictor_version"]), runtime_seconds=float(value["runtime_seconds"]), success=bool(value["success"]), cache_hit=bool(value.get("cache_hit", False)), workspace_weight=float(value.get("workspace_weight", 1.0)), retry_reason=None if value.get("retry_reason") is None else str(value["retry_reason"]), checkpoint_restored_seconds=float(value.get("checkpoint_restored_seconds", 0.0)), metadata=dict(metadata))


def shadow_attempt_to_mapping(record: ShadowTaskAttempt) -> dict[str, Any]:
    return {"schema_version": record.schema_version, "attempt_id": record.attempt_id, "task_id": record.task_id, "attempt_number": record.attempt_number, "workspace_id": record.workspace_id, "task_type": record.task_type, "model": record.model, "input_tokens": record.input_tokens, "context_tokens": record.context_tokens, "file_count": record.file_count, "subagent_depth": record.subagent_depth, "priority": record.priority, "queued_at": record.queued_at.isoformat(), "started_at": record.started_at.isoformat(), "completed_at": record.completed_at.isoformat(), "feature_snapshot_at": record.feature_snapshot_at.isoformat(), "predicted_at": record.predicted_at.isoformat(), "predicted_runtime_seconds": record.predicted_runtime_seconds, "predictor_version": record.predictor_version, "runtime_seconds": record.runtime_seconds, "success": record.success, "cache_hit": record.cache_hit, "workspace_weight": record.workspace_weight, "retry_reason": record.retry_reason, "checkpoint_restored_seconds": record.checkpoint_restored_seconds, "metadata": dict(record.metadata)}


def write_shadow_replay_jsonl(records: Sequence[ShadowTaskAttempt], path: Path) -> Path:
    serialized = "\n".join(json.dumps(shadow_attempt_to_mapping(record), ensure_ascii=False, separators=(",", ":")) for record in records)
    path.write_text(serialized + "\n", encoding="utf-8")
    return path


def load_shadow_replay_jsonl(path: Path, *, worker_count: int, strict: bool = True) -> tuple[tuple[ShadowTaskAttempt, ...], ShadowReplayValidationReport]:
    records: list[ShadowTaskAttempt] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
            if not isinstance(value, Mapping):
                raise ValueError("JSONL row must be an object")
            records.append(shadow_attempt_from_mapping(value))
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            issue = ValidationIssue(level=ValidationLevel.ERROR, attempt_id=None, message=f"line {line_number}: {error}")
            report = ShadowReplayValidationReport(record_count=len(records), error_count=1, warning_count=0, maximum_observed_concurrency=0, retry_attempt_rate=0.0, checkpoint_resume_rate=0.0, issues=tuple([issue]))
            raise ShadowReplayValidationError(report) from error
    report = validate_shadow_replay(records, worker_count=worker_count)
    if strict and not report.is_valid:
        raise ShadowReplayValidationError(report)
    return tuple(records), report


def _maximum_concurrency(records: Sequence[ShadowTaskAttempt]) -> int:
    events = [(record.started_at, 1) for record in records if not record.cache_hit]
    events.extend((record.completed_at, -1) for record in records if not record.cache_hit)
    current = 0
    maximum = 0
    for _, delta in sorted(events, key=lambda event: (event[0], event[1])):
        current += delta
        maximum = max(maximum, current)
    return maximum


def validate_shadow_replay(records: Sequence[ShadowTaskAttempt], *, worker_count: int) -> ShadowReplayValidationReport:
    if worker_count < 1:
        raise ValueError("worker count must be positive")
    issues: list[ValidationIssue] = []
    if not records:
        issues.append(ValidationIssue(ValidationLevel.ERROR, None, "shadow replay dataset must not be empty"))
    attempt_ids: set[str] = set()
    task_attempt_keys: set[tuple[str, int]] = set()
    grouped: dict[str, list[ShadowTaskAttempt]] = defaultdict(list)
    for record in records:
        attempt_id = record.attempt_id or None
        if record.schema_version != SHADOW_REPLAY_SCHEMA_VERSION:
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, f"unsupported schema version: {record.schema_version}"))
        if not all(value.strip() for value in (record.attempt_id, record.task_id, record.workspace_id, record.task_type, record.model, record.predictor_version)):
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, "identifier and categorical fields must not be blank"))
        if record.attempt_id in attempt_ids:
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, "attempt_id must be unique"))
        attempt_ids.add(record.attempt_id)
        task_attempt_key = (record.task_id, record.attempt_number)
        if task_attempt_key in task_attempt_keys:
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, "task_id and attempt_number pair must be unique"))
        task_attempt_keys.add(task_attempt_key)
        if record.attempt_number < 1 or not 1 <= record.priority <= 5:
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, "attempt number and priority are invalid"))
        if min(record.input_tokens, record.context_tokens, record.file_count, record.subagent_depth) < 0:
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, "pre-dispatch numeric features must be non-negative"))
        if record.predicted_runtime_seconds <= 0 or record.runtime_seconds <= 0 or record.workspace_weight <= 0 or record.checkpoint_restored_seconds < 0:
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, "runtime, workspace weight and checkpoint values are invalid"))
        if not record.queued_at <= record.started_at <= record.completed_at:
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, "timestamps must satisfy queued_at <= started_at <= completed_at"))
        if record.feature_snapshot_at > record.queued_at or record.predicted_at > record.queued_at:
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, "feature snapshot and prediction must exist no later than queued_at"))
        measured_runtime = (record.completed_at - record.started_at).total_seconds()
        if not math.isclose(record.runtime_seconds, measured_runtime, rel_tol=0.0, abs_tol=1e-6):
            issues.append(ValidationIssue(ValidationLevel.ERROR, attempt_id, "runtime_seconds must equal completed_at - started_at"))
        if record.attempt_number > 1 and record.retry_reason is None:
            issues.append(ValidationIssue(ValidationLevel.WARNING, attempt_id, "retry attempt should include retry_reason"))
        if record.checkpoint_restored_seconds > 0 and record.attempt_number == 1:
            issues.append(ValidationIssue(ValidationLevel.WARNING, attempt_id, "first attempt unexpectedly restores checkpoint progress"))
        grouped[record.task_id].append(record)
    for task_records in grouped.values():
        ordered = sorted(task_records, key=lambda record: record.attempt_number)
        if [record.attempt_number for record in ordered] != list(range(1, len(ordered) + 1)):
            issues.append(ValidationIssue(ValidationLevel.ERROR, ordered[0].attempt_id, "attempt numbers must be contiguous from one"))
        for previous, current in zip(ordered, ordered[1:], strict=False):
            if current.queued_at < previous.completed_at:
                issues.append(ValidationIssue(ValidationLevel.ERROR, current.attempt_id, "retry must not queue before the previous attempt completes"))
    maximum_concurrency = _maximum_concurrency(records)
    if maximum_concurrency > worker_count:
        issues.append(ValidationIssue(ValidationLevel.ERROR, None, f"observed concurrency {maximum_concurrency} exceeds configured worker count {worker_count}"))
    retry_attempt_count = sum(record.attempt_number > 1 for record in records)
    checkpoint_resume_count = sum(record.checkpoint_restored_seconds > 0 for record in records)
    errors = sum(issue.level is ValidationLevel.ERROR for issue in issues)
    warnings = len(issues) - errors
    return ShadowReplayValidationReport(record_count=len(records), error_count=errors, warning_count=warnings, maximum_observed_concurrency=maximum_concurrency, retry_attempt_rate=0.0 if not records else retry_attempt_count / len(records), checkpoint_resume_rate=0.0 if not records else checkpoint_resume_count / len(records), issues=tuple(issues))


def _workspace_fairness(records: Sequence[ShadowTaskAttempt], completion_seconds: Mapping[str, float]) -> float:
    grouped: dict[str, list[float]] = defaultdict(list)
    for record in records:
        grouped[record.workspace_id].append(completion_seconds[record.attempt_id] / record.runtime_seconds)
    inverse_mean_slowdowns = [1 / mean(values) for values in grouped.values()]
    return _jain_index(inverse_mean_slowdowns)


def _metrics(records: Sequence[ShadowTaskAttempt], waits: Mapping[str, float], completions: Mapping[str, float], completion_slo_seconds: float) -> ReplayMetrics:
    wait_values = [waits[record.attempt_id] for record in records]
    completion_values = [completions[record.attempt_id] for record in records]
    success_count = sum(record.success for record in records)
    slo_count = sum(record.success and completions[record.attempt_id] <= completion_slo_seconds for record in records)
    return ReplayMetrics(task_count=len(records), success_rate=success_count / len(records), completion_slo_rate=slo_count / len(records), mean_wait_seconds=mean(wait_values), p95_wait_seconds=_percentile(wait_values, 95), maximum_wait_seconds=max(wait_values), mean_completion_seconds=mean(completion_values), p95_completion_seconds=_percentile(completion_values, 95), fairness_index=_workspace_fairness(records, completions))


def run_shadow_replay(records: Sequence[ShadowTaskAttempt], *, worker_count: int, completion_slo_seconds: float = 300.0, policies: Sequence[SchedulingPolicy] = (SchedulingPolicy.FIFO, SchedulingPolicy.GLOBAL_PREDICTED_SJF, SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, SchedulingPolicy.FAIR_PREDICTED_SJF_AGING), max_wait_seconds: float = 120.0, aging_rate: float = 0.02, aging_overdue_interval: int = 4) -> ShadowReplayResult:
    if not records or not policies:
        raise ValueError("records and policies must not be empty")
    validation = validate_shadow_replay(records, worker_count=worker_count)
    if not validation.is_valid:
        raise ShadowReplayValidationError(validation)
    anchor = min(record.queued_at for record in records)
    scheduler_tasks = [SchedulerTask(task_id=record.attempt_id, workspace_id=record.workspace_id, queued_at_seconds=(record.queued_at - anchor).total_seconds(), actual_runtime_seconds=record.runtime_seconds, predicted_runtime_seconds=record.predicted_runtime_seconds, priority=record.priority, workspace_weight=record.workspace_weight, cache_hit=record.cache_hit, cache_lookup_seconds=record.runtime_seconds if record.cache_hit else 0.02) for record in records]
    observed_waits = {record.attempt_id: record.queue_wait_seconds for record in records}
    observed_completions = {record.attempt_id: record.completion_seconds for record in records}
    results = [ReplayPolicyResult(name="Observed production order", source=ReplaySource.OBSERVED, metrics=_metrics(records, observed_waits, observed_completions, completion_slo_seconds))]
    for policy in policies:
        simulation = simulate_scheduler(scheduler_tasks, policy, worker_count=worker_count, max_wait_seconds=max_wait_seconds, aging_rate=aging_rate, aging_overdue_interval=aging_overdue_interval)
        by_id = {result.task_id: result for result in simulation.task_results}
        waits = {record.attempt_id: by_id[record.attempt_id].queue_wait_seconds for record in records}
        completions = {record.attempt_id: by_id[record.attempt_id].completion_time_seconds for record in records}
        results.append(ReplayPolicyResult(name=policy.value, source=ReplaySource.COUNTERFACTUAL, metrics=_metrics(records, waits, completions, completion_slo_seconds)))
    return ShadowReplayResult(validation=validation, worker_count=worker_count, completion_slo_seconds=completion_slo_seconds, results=tuple(results))
