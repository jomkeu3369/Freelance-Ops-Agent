from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from pathlib import Path
from typing import Any

from .shadow_replay import SHADOW_REPLAY_SCHEMA_VERSION, ShadowTaskAttempt


TASK_ATTEMPT_TELEMETRY_SCHEMA_VERSION = "task-attempt-telemetry-v1"
FORBIDDEN_DATA_KEYS = frozenset(("api_key", "chain_of_thought", "delegation_token", "prompt", "secret"))


class AttemptEventType(StrEnum):
    PREDICTED = "attempt.predicted"
    QUEUED = "attempt.queued"
    STARTED = "attempt.started"
    CHECKPOINTED = "attempt.checkpointed"
    FAILED = "attempt.failed"
    RETRY_DECIDED = "attempt.retry_decided"
    COMPLETED = "attempt.completed"
    INCIDENT_FINALIZED = "attempt.incident_finalized"


class RetryDecision(StrEnum):
    ALLOW = "allow"
    DENY = "deny"


class RetryDecisionReason(StrEnum):
    RETRY_ALLOWED = "RETRY_ALLOWED"
    WORKSPACE_BUCKET_EMPTY = "WORKSPACE_BUCKET_EMPTY"
    GLOBAL_BUCKET_EMPTY = "GLOBAL_BUCKET_EMPTY"
    MAX_ATTEMPTS_REACHED = "MAX_ATTEMPTS_REACHED"
    CORRELATED_FAILURE_CIRCUIT_OPEN = "CORRELATED_FAILURE_CIRCUIT_OPEN"
    PRIORITY_BORROW_ALLOWED = "PRIORITY_BORROW_ALLOWED"


class TelemetryIssueLevel(StrEnum):
    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True, slots=True)
class TaskAttemptTelemetryEvent:
    schema_version: str
    event_id: str
    source_event_id: str
    task_id: str
    attempt_id: str
    attempt_number: int
    workspace_id: str
    sequence: int
    event_type: AttemptEventType
    occurred_at: datetime
    received_at: datetime
    data: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RetryDecisionSnapshot:
    task_id: str
    attempt_id: str
    attempt_number: int
    workspace_id: str
    decided_at: datetime
    decision: RetryDecision
    reason: RetryDecisionReason
    failure_classification: str
    classification_confidence: float
    classifier_version: str
    bucket_policy_version: str
    workspace_tokens_before: float
    workspace_tokens_after: float
    global_tokens_before: float
    global_tokens_after: float
    retry_ready_at: datetime | None


@dataclass(frozen=True, slots=True)
class TelemetryIssue:
    level: TelemetryIssueLevel
    event_id: str | None
    message: str


@dataclass(frozen=True, slots=True)
class TaskAttemptTelemetryValidationReport:
    event_count: int
    attempt_count: int
    error_count: int
    warning_count: int
    duplicate_source_event_count: int
    maximum_ingestion_delay_seconds: float
    p95_ingestion_delay_seconds: float
    issues: tuple[TelemetryIssue, ...]

    @property
    def is_valid(self) -> bool:
        return self.error_count == 0


@dataclass(frozen=True, slots=True)
class TaskAttemptTelemetryDataset:
    attempts: tuple[ShadowTaskAttempt, ...]
    retry_decisions: tuple[RetryDecisionSnapshot, ...]
    validation: TaskAttemptTelemetryValidationReport


class TaskAttemptTelemetryValidationError(ValueError):
    def __init__(self, report: TaskAttemptTelemetryValidationReport) -> None:
        self.report = report
        messages = "; ".join(issue.message for issue in report.issues if issue.level is TelemetryIssueLevel.ERROR)
        super().__init__(messages or "task attempt telemetry validation failed")


def _parse_datetime(value: object, field_name: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be an ISO-8601 string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone offset")
    return parsed.astimezone(UTC)


def telemetry_event_from_mapping(value: Mapping[str, Any]) -> TaskAttemptTelemetryEvent:
    required = ("schema_version", "event_id", "source_event_id", "task_id", "attempt_id", "attempt_number", "workspace_id", "sequence", "event_type", "occurred_at", "received_at", "data")
    missing = [name for name in required if name not in value]
    if missing:
        raise ValueError(f"missing required telemetry fields: {', '.join(missing)}")
    data = value["data"]
    if not isinstance(data, Mapping):
        raise ValueError("data must be an object")
    return TaskAttemptTelemetryEvent(schema_version=str(value["schema_version"]), event_id=str(value["event_id"]), source_event_id=str(value["source_event_id"]), task_id=str(value["task_id"]), attempt_id=str(value["attempt_id"]), attempt_number=int(value["attempt_number"]), workspace_id=str(value["workspace_id"]), sequence=int(value["sequence"]), event_type=AttemptEventType(str(value["event_type"])), occurred_at=_parse_datetime(value["occurred_at"], "occurred_at"), received_at=_parse_datetime(value["received_at"], "received_at"), data=dict(data))


def telemetry_event_to_mapping(event: TaskAttemptTelemetryEvent) -> dict[str, Any]:
    return {"schema_version": event.schema_version, "event_id": event.event_id, "source_event_id": event.source_event_id, "task_id": event.task_id, "attempt_id": event.attempt_id, "attempt_number": event.attempt_number, "workspace_id": event.workspace_id, "sequence": event.sequence, "event_type": event.event_type.value, "occurred_at": event.occurred_at.isoformat(), "received_at": event.received_at.isoformat(), "data": dict(event.data)}


def write_task_attempt_telemetry_jsonl(events: Sequence[TaskAttemptTelemetryEvent], path: Path) -> Path:
    serialized = "\n".join(json.dumps(telemetry_event_to_mapping(event), ensure_ascii=False, separators=(",", ":")) for event in events)
    path.write_text(serialized + "\n", encoding="utf-8")
    return path


def load_task_attempt_telemetry_jsonl(path: Path, *, strict: bool = True) -> TaskAttemptTelemetryDataset:
    events: list[TaskAttemptTelemetryEvent] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
            if not isinstance(value, Mapping):
                raise ValueError("JSONL row must be an object")
            events.append(telemetry_event_from_mapping(value))
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            issue = TelemetryIssue(TelemetryIssueLevel.ERROR, None, f"line {line_number}: {error}")
            report = TaskAttemptTelemetryValidationReport(event_count=len(events), attempt_count=0, error_count=1, warning_count=0, duplicate_source_event_count=0, maximum_ingestion_delay_seconds=0.0, p95_ingestion_delay_seconds=0.0, issues=tuple([issue]))
            raise TaskAttemptTelemetryValidationError(report) from error
    return assemble_task_attempt_telemetry(events, strict=strict)


def _contains_forbidden_key(value: object) -> bool:
    if isinstance(value, Mapping):
        return any(str(key).lower() in FORBIDDEN_DATA_KEYS or _contains_forbidden_key(item) for key, item in value.items())
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return any(_contains_forbidden_key(item) for item in value)
    return False


def _percentile(values: Sequence[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile / 100
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _single_event(group: Sequence[TaskAttemptTelemetryEvent], event_type: AttemptEventType, issues: list[TelemetryIssue], *, required: bool = True) -> TaskAttemptTelemetryEvent | None:
    selected = [event for event in group if event.event_type is event_type]
    if required and len(selected) != 1:
        event_id = group[0].event_id if group else None
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, f"attempt requires exactly one {event_type.value} event"))
    elif not required and len(selected) > 1:
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, selected[0].event_id, f"attempt permits at most one {event_type.value} event"))
    return selected[0] if len(selected) == 1 else None


def _validate_retry_decision(event: TaskAttemptTelemetryEvent, issues: list[TelemetryIssue]) -> RetryDecisionSnapshot | None:
    required = ("decision", "reason", "failure_classification", "classification_confidence", "classifier_version", "bucket_policy_version", "workspace_tokens_before", "workspace_tokens_after", "global_tokens_before", "global_tokens_after")
    if any(name not in event.data for name in required):
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "retry decision is missing required snapshot fields"))
        return None
    if "final_incident_kind" in event.data or "final_label_source" in event.data:
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "retry decision must not contain post-incident final labels"))
    try:
        decision = RetryDecision(str(event.data["decision"]))
        reason = RetryDecisionReason(str(event.data["reason"]))
        confidence = float(event.data["classification_confidence"])
        workspace_before = float(event.data["workspace_tokens_before"])
        workspace_after = float(event.data["workspace_tokens_after"])
        global_before = float(event.data["global_tokens_before"])
        global_after = float(event.data["global_tokens_after"])
        retry_ready_raw = event.data.get("retry_ready_at")
        retry_ready_at = None if retry_ready_raw is None else _parse_datetime(retry_ready_raw, "retry_ready_at")
    except (TypeError, ValueError) as error:
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, f"invalid retry decision snapshot: {error}"))
        return None
    if not 0 <= confidence <= 1 or min(workspace_before, workspace_after, global_before, global_after) < 0:
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "retry confidence and token values are invalid"))
    allowed_reason = reason in (RetryDecisionReason.RETRY_ALLOWED, RetryDecisionReason.PRIORITY_BORROW_ALLOWED)
    if decision is RetryDecision.ALLOW and not allowed_reason:
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "allowed retry must use an allowed reason"))
    if decision is RetryDecision.DENY and allowed_reason:
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "denied retry must use a denial reason"))
    if decision is RetryDecision.ALLOW:
        if not math.isclose(workspace_before - workspace_after, 1.0, abs_tol=1e-6) or not math.isclose(global_before - global_after, 1.0, abs_tol=1e-6):
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "allowed hierarchical retry must consume one workspace and one global token"))
        if retry_ready_at is None or retry_ready_at < event.occurred_at:
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "allowed retry must include a future retry_ready_at"))
    elif not math.isclose(workspace_before, workspace_after, abs_tol=1e-6) or not math.isclose(global_before, global_after, abs_tol=1e-6):
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "denied retry must not consume tokens"))
    if reason is RetryDecisionReason.WORKSPACE_BUCKET_EMPTY and workspace_before >= 1:
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "workspace bucket denial requires fewer than one token"))
    if reason is RetryDecisionReason.GLOBAL_BUCKET_EMPTY and global_before >= 1:
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "global bucket denial requires fewer than one token"))
    if reason is RetryDecisionReason.CORRELATED_FAILURE_CIRCUIT_OPEN and str(event.data["failure_classification"]) != "correlated":
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event.event_id, "circuit-open denial requires correlated failure classification"))
    return RetryDecisionSnapshot(task_id=event.task_id, attempt_id=event.attempt_id, attempt_number=event.attempt_number, workspace_id=event.workspace_id, decided_at=event.occurred_at, decision=decision, reason=reason, failure_classification=str(event.data["failure_classification"]), classification_confidence=confidence, classifier_version=str(event.data["classifier_version"]), bucket_policy_version=str(event.data["bucket_policy_version"]), workspace_tokens_before=workspace_before, workspace_tokens_after=workspace_after, global_tokens_before=global_before, global_tokens_after=global_after, retry_ready_at=retry_ready_at)


def validate_task_attempt_telemetry(events: Sequence[TaskAttemptTelemetryEvent], *, warning_delay_seconds: float = 30.0, maximum_delay_seconds: float = 300.0, clock_skew_seconds: float = 2.0) -> TaskAttemptTelemetryValidationReport:
    if warning_delay_seconds < 0 or maximum_delay_seconds < warning_delay_seconds or clock_skew_seconds < 0:
        raise ValueError("telemetry delay thresholds are invalid")
    issues: list[TelemetryIssue] = []
    if not events:
        issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, None, "task attempt telemetry must not be empty"))
    event_ids: set[str] = set()
    source_event_ids: set[str] = set()
    duplicate_source_count = 0
    ingestion_delays: list[float] = []
    grouped: dict[str, list[TaskAttemptTelemetryEvent]] = defaultdict(list)
    for event in events:
        event_id = event.event_id or None
        if event.schema_version != TASK_ATTEMPT_TELEMETRY_SCHEMA_VERSION:
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, f"unsupported telemetry schema version: {event.schema_version}"))
        if not all(value.strip() for value in (event.event_id, event.source_event_id, event.task_id, event.attempt_id, event.workspace_id)):
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, "telemetry identifiers must not be blank"))
        if event.event_id in event_ids:
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, "event_id must be unique"))
        event_ids.add(event.event_id)
        if event.source_event_id in source_event_ids:
            duplicate_source_count += 1
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, "source_event_id must be unique after ingestion deduplication"))
        source_event_ids.add(event.source_event_id)
        if event.attempt_number < 1 or event.sequence < 1:
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, "attempt number and sequence must be positive"))
        delay = (event.received_at - event.occurred_at).total_seconds()
        ingestion_delays.append(max(0.0, delay))
        if delay < -clock_skew_seconds:
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, "received_at predates occurred_at beyond allowed clock skew"))
        elif delay > maximum_delay_seconds:
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, "telemetry ingestion delay exceeds replay limit"))
        elif delay > warning_delay_seconds:
            issues.append(TelemetryIssue(TelemetryIssueLevel.WARNING, event_id, "telemetry ingestion delay exceeds warning threshold"))
        if _contains_forbidden_key(event.data):
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, "telemetry data contains forbidden secret or reasoning fields"))
        grouped[event.attempt_id].append(event)
    decisions: dict[str, RetryDecisionSnapshot] = {}
    attempt_terminal: dict[str, TaskAttemptTelemetryEvent] = {}
    attempt_queued: dict[str, TaskAttemptTelemetryEvent] = {}
    task_attempts: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for attempt_id, group in grouped.items():
        ordered = sorted(group, key=lambda event: event.sequence)
        first = ordered[0]
        if any(event.task_id != first.task_id or event.workspace_id != first.workspace_id or event.attempt_number != first.attempt_number for event in ordered):
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, first.event_id, "attempt event identity fields must remain stable"))
        if [event.sequence for event in ordered] != list(range(1, len(ordered) + 1)):
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, first.event_id, "attempt sequences must be contiguous from one"))
        if any(current.occurred_at < previous.occurred_at for previous, current in zip(ordered, ordered[1:], strict=False)):
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, first.event_id, "occurred_at must be non-decreasing by attempt sequence"))
        predicted = _single_event(ordered, AttemptEventType.PREDICTED, issues)
        queued = _single_event(ordered, AttemptEventType.QUEUED, issues)
        started = _single_event(ordered, AttemptEventType.STARTED, issues)
        failed = _single_event(ordered, AttemptEventType.FAILED, issues, required=False)
        completed = _single_event(ordered, AttemptEventType.COMPLETED, issues, required=False)
        retry_event = _single_event(ordered, AttemptEventType.RETRY_DECIDED, issues, required=False)
        finalized = _single_event(ordered, AttemptEventType.INCIDENT_FINALIZED, issues, required=False)
        if (failed is None) == (completed is None):
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, first.event_id, "attempt requires exactly one failed or completed terminal event"))
        terminal = failed or completed
        if predicted is not None and queued is not None and started is not None and terminal is not None:
            if not predicted.occurred_at <= queued.occurred_at <= started.occurred_at <= terminal.occurred_at:
                issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, first.event_id, "attempt lifecycle timestamps are out of order"))
            feature_snapshot_raw = predicted.data.get("feature_snapshot_at")
            try:
                feature_snapshot_at = _parse_datetime(feature_snapshot_raw, "feature_snapshot_at")
                if feature_snapshot_at > predicted.occurred_at:
                    issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, predicted.event_id, "feature snapshot must not postdate prediction"))
            except ValueError as error:
                issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, predicted.event_id, str(error)))
            try:
                measured_runtime = (terminal.occurred_at - started.occurred_at).total_seconds()
                if not math.isclose(float(terminal.data["runtime_seconds"]), measured_runtime, abs_tol=1e-6):
                    issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, terminal.event_id, "terminal runtime_seconds must equal terminal_at - started_at"))
            except (KeyError, TypeError, ValueError):
                issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, terminal.event_id, "terminal event requires numeric runtime_seconds"))
        if completed is not None and retry_event is not None:
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, retry_event.event_id, "completed attempt must not have a retry decision"))
        if retry_event is not None:
            if failed is None or retry_event.occurred_at < failed.occurred_at:
                issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, retry_event.event_id, "retry decision must follow a failed terminal event"))
            snapshot = _validate_retry_decision(retry_event, issues)
            if snapshot is not None:
                decisions[attempt_id] = snapshot
        if finalized is not None and (retry_event is None or finalized.occurred_at < retry_event.occurred_at):
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, finalized.event_id, "final incident label must follow the retry decision"))
        if terminal is not None:
            attempt_terminal[attempt_id] = terminal
        if queued is not None:
            attempt_queued[attempt_id] = queued
        task_attempts[first.task_id].append((first.attempt_number, attempt_id))
    for attempts in task_attempts.values():
        ordered_attempts = sorted(attempts)
        if [number for number, _ in ordered_attempts] != list(range(1, len(ordered_attempts) + 1)):
            issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, None, "task attempt numbers must be contiguous from one"))
        for (_, previous_id), (_, current_id) in zip(ordered_attempts, ordered_attempts[1:], strict=False):
            terminal = attempt_terminal.get(previous_id)
            queued = attempt_queued.get(current_id)
            decision = decisions.get(previous_id)
            if terminal is not None and queued is not None and queued.occurred_at < terminal.occurred_at:
                issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, queued.event_id, "retry attempt must not queue before the previous attempt terminates"))
            if decision is None or decision.decision is not RetryDecision.ALLOW:
                event_id = queued.event_id if queued is not None else None
                issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, event_id, "retry attempt requires an allowed prior retry decision"))
            elif queued is not None and decision.retry_ready_at is not None and queued.occurred_at < decision.retry_ready_at:
                issues.append(TelemetryIssue(TelemetryIssueLevel.ERROR, queued.event_id, "retry attempt queued before retry_ready_at"))
    errors = sum(issue.level is TelemetryIssueLevel.ERROR for issue in issues)
    warnings = len(issues) - errors
    return TaskAttemptTelemetryValidationReport(event_count=len(events), attempt_count=len(grouped), error_count=errors, warning_count=warnings, duplicate_source_event_count=duplicate_source_count, maximum_ingestion_delay_seconds=max(ingestion_delays, default=0.0), p95_ingestion_delay_seconds=_percentile(ingestion_delays, 95), issues=tuple(issues))


def _attempt_from_events(group: Sequence[TaskAttemptTelemetryEvent], previous_decision: RetryDecisionSnapshot | None) -> ShadowTaskAttempt:
    by_type = {event.event_type: event for event in group}
    predicted = by_type[AttemptEventType.PREDICTED]
    queued = by_type[AttemptEventType.QUEUED]
    started = by_type[AttemptEventType.STARTED]
    terminal = by_type.get(AttemptEventType.COMPLETED) or by_type[AttemptEventType.FAILED]
    checkpoints = [event for event in group if event.event_type is AttemptEventType.CHECKPOINTED]
    checkpoint_restored = float(predicted.data.get("checkpoint_restored_seconds", 0.0))
    success = terminal.event_type is AttemptEventType.COMPLETED
    return ShadowTaskAttempt(schema_version=SHADOW_REPLAY_SCHEMA_VERSION, attempt_id=terminal.attempt_id, task_id=terminal.task_id, attempt_number=terminal.attempt_number, workspace_id=terminal.workspace_id, task_type=str(predicted.data["task_type"]), model=str(predicted.data["model"]), input_tokens=int(predicted.data["input_tokens"]), context_tokens=int(predicted.data["context_tokens"]), file_count=int(predicted.data["file_count"]), subagent_depth=int(predicted.data["subagent_depth"]), priority=int(queued.data["priority"]), queued_at=queued.occurred_at, started_at=started.occurred_at, completed_at=terminal.occurred_at, feature_snapshot_at=_parse_datetime(predicted.data["feature_snapshot_at"], "feature_snapshot_at"), predicted_at=predicted.occurred_at, predicted_runtime_seconds=float(predicted.data["predicted_runtime_seconds"]), predictor_version=str(predicted.data["predictor_version"]), runtime_seconds=float(terminal.data["runtime_seconds"]), success=success, cache_hit=bool(queued.data.get("cache_hit", False)), workspace_weight=float(queued.data.get("workspace_weight", 1.0)), retry_reason=None if previous_decision is None else previous_decision.reason.value, checkpoint_restored_seconds=checkpoint_restored, metadata={"telemetry_schema_version": TASK_ATTEMPT_TELEMETRY_SCHEMA_VERSION, "checkpoint_event_count": len(checkpoints), "failure_code": terminal.data.get("failure_code")})


def assemble_task_attempt_telemetry(events: Sequence[TaskAttemptTelemetryEvent], *, strict: bool = True, warning_delay_seconds: float = 30.0, maximum_delay_seconds: float = 300.0) -> TaskAttemptTelemetryDataset:
    report = validate_task_attempt_telemetry(events, warning_delay_seconds=warning_delay_seconds, maximum_delay_seconds=maximum_delay_seconds)
    if not report.is_valid:
        if strict:
            raise TaskAttemptTelemetryValidationError(report)
        return TaskAttemptTelemetryDataset(attempts=(), retry_decisions=(), validation=report)
    grouped: dict[str, list[TaskAttemptTelemetryEvent]] = defaultdict(list)
    for event in events:
        grouped[event.attempt_id].append(event)
    decision_by_attempt = {event.attempt_id: _validate_retry_decision(event, []) for event in events if event.event_type is AttemptEventType.RETRY_DECIDED}
    previous_decisions: dict[tuple[str, int], RetryDecisionSnapshot] = {}
    for decision in decision_by_attempt.values():
        if decision is not None:
            previous_decisions[(decision.task_id, decision.attempt_number + 1)] = decision
    attempts = tuple(sorted((_attempt_from_events(group, previous_decisions.get((group[0].task_id, group[0].attempt_number))) for group in grouped.values()), key=lambda attempt: (attempt.queued_at, attempt.task_id, attempt.attempt_number)))
    decisions = tuple(sorted((decision for decision in decision_by_attempt.values() if decision is not None), key=lambda decision: decision.decided_at))
    return TaskAttemptTelemetryDataset(attempts=attempts, retry_decisions=decisions, validation=report)


def _event(task_id: str, attempt_id: str, attempt_number: int, workspace_id: str, sequence: int, event_type: AttemptEventType, occurred_at: datetime, data: Mapping[str, Any], rng: random.Random) -> TaskAttemptTelemetryEvent:
    received_at = occurred_at + timedelta(seconds=rng.uniform(0.01, 0.50))
    event_id = f"{attempt_id}:{sequence}"
    return TaskAttemptTelemetryEvent(schema_version=TASK_ATTEMPT_TELEMETRY_SCHEMA_VERSION, event_id=event_id, source_event_id=f"worker:{event_id}", task_id=task_id, attempt_id=attempt_id, attempt_number=attempt_number, workspace_id=workspace_id, sequence=sequence, event_type=event_type, occurred_at=occurred_at, received_at=received_at, data=dict(data))


def generate_task_attempt_telemetry(task_count: int = 100, *, retry_rate: float = 0.20, random_seed: int = 42) -> tuple[tuple[TaskAttemptTelemetryEvent, ...], tuple[ShadowTaskAttempt, ...]]:
    if task_count < 1 or not 0 <= retry_rate <= 1:
        raise ValueError("task count and retry rate are invalid")
    rng = random.Random(random_seed)
    anchor = datetime(2026, 8, 27, tzinfo=UTC)
    events: list[TaskAttemptTelemetryEvent] = []
    for task_index in range(task_count):
        task_id = f"task-{task_index:05d}"
        workspace_id = f"workspace-{task_index % 4}"
        should_retry = rng.random() < retry_rate
        attempt_count = 2 if should_retry else 1
        previous_terminal = anchor + timedelta(seconds=task_index * 4.0)
        previous_retry_ready: datetime | None = None
        for attempt_number in range(1, attempt_count + 1):
            attempt_id = f"{task_id}-attempt-{attempt_number}"
            prediction_at = previous_terminal + timedelta(seconds=0.2)
            queued_at = max(prediction_at + timedelta(seconds=0.1), previous_retry_ready or prediction_at)
            started_at = queued_at + timedelta(seconds=rng.uniform(0.5, 4.0))
            runtime = rng.uniform(8.0, 40.0)
            terminal_at = started_at + timedelta(seconds=runtime)
            predicted_runtime = runtime * rng.uniform(0.80, 1.20)
            prediction_data = {"task_type": "code_review" if task_index % 2 == 0 else "research", "model": "primary-model", "input_tokens": 1_000 + task_index * 10, "context_tokens": 2_000 + task_index * 20, "file_count": task_index % 12, "subagent_depth": task_index % 3, "feature_snapshot_at": (prediction_at - timedelta(seconds=0.1)).isoformat(), "predicted_runtime_seconds": predicted_runtime, "predictor_version": "runtime-v1", "checkpoint_restored_seconds": 10.0 if attempt_number > 1 else 0.0}
            events.append(_event(task_id, attempt_id, attempt_number, workspace_id, 1, AttemptEventType.PREDICTED, prediction_at, prediction_data, rng))
            events.append(_event(task_id, attempt_id, attempt_number, workspace_id, 2, AttemptEventType.QUEUED, queued_at, {"priority": 5 if task_index % 10 == 0 else 3, "workspace_weight": 1.0, "cache_hit": False}, rng))
            events.append(_event(task_id, attempt_id, attempt_number, workspace_id, 3, AttemptEventType.STARTED, started_at, {}, rng))
            terminal_type = AttemptEventType.FAILED if should_retry and attempt_number == 1 else AttemptEventType.COMPLETED
            terminal_data = {"runtime_seconds": runtime, "success": terminal_type is AttemptEventType.COMPLETED, "failure_code": "provider_timeout" if terminal_type is AttemptEventType.FAILED else None}
            events.append(_event(task_id, attempt_id, attempt_number, workspace_id, 4, terminal_type, terminal_at, terminal_data, rng))
            previous_terminal = terminal_at
            if terminal_type is AttemptEventType.FAILED:
                retry_ready = terminal_at + timedelta(seconds=15.0)
                retry_data = {"decision": RetryDecision.ALLOW.value, "reason": RetryDecisionReason.RETRY_ALLOWED.value, "failure_classification": "independent", "classification_confidence": 0.92, "classifier_version": "failure-rule-v1", "bucket_policy_version": "retry-bucket-v1", "workspace_tokens_before": 12.0, "workspace_tokens_after": 11.0, "global_tokens_before": 16.0, "global_tokens_after": 15.0, "retry_ready_at": retry_ready.isoformat()}
                events.append(_event(task_id, attempt_id, attempt_number, workspace_id, 5, AttemptEventType.RETRY_DECIDED, terminal_at + timedelta(seconds=0.1), retry_data, rng))
                previous_retry_ready = retry_ready
    rng.shuffle(events)
    dataset = assemble_task_attempt_telemetry(events)
    return tuple(events), dataset.attempts
