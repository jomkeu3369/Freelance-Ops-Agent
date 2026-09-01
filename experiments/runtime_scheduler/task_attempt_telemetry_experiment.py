from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import timedelta
from enum import StrEnum

from .scheduler_simulation import MetricEstimate, _estimate
from .shadow_replay import ShadowTaskAttempt
from .task_attempt_telemetry import AttemptEventType, TaskAttemptTelemetryEvent, assemble_task_attempt_telemetry, generate_task_attempt_telemetry, validate_task_attempt_telemetry


class TelemetryFault(StrEnum):
    CLEAN = "clean"
    RECEIVE_REORDERING = "receive_reordering"
    DUPLICATE_SOURCE_EVENT = "duplicate_source_event"
    MISSING_PREDICTION = "missing_prediction"
    SEQUENCE_GAP = "sequence_gap"
    OCCURRED_TIME_REGRESSION = "occurred_time_regression"
    EXCESSIVE_INGESTION_DELAY = "excessive_ingestion_delay"
    FEATURE_SNAPSHOT_LEAK = "feature_snapshot_leak"
    SECRET_LEAK = "secret_leak"
    RUNTIME_MISMATCH = "runtime_mismatch"
    TOKEN_ACCOUNTING = "token_accounting"
    FINAL_LABEL_LEAK = "final_label_leak"
    RETRY_WITHOUT_DECISION = "retry_without_decision"


FAULT_LABELS = {TelemetryFault.CLEAN: "Clean stream", TelemetryFault.RECEIVE_REORDERING: "Receive reordering", TelemetryFault.DUPLICATE_SOURCE_EVENT: "Duplicate source event", TelemetryFault.MISSING_PREDICTION: "Missing prediction", TelemetryFault.SEQUENCE_GAP: "Sequence gap", TelemetryFault.OCCURRED_TIME_REGRESSION: "Occurred-time regression", TelemetryFault.EXCESSIVE_INGESTION_DELAY: "Excessive ingestion delay", TelemetryFault.FEATURE_SNAPSHOT_LEAK: "Feature snapshot leakage", TelemetryFault.SECRET_LEAK: "Secret field leakage", TelemetryFault.RUNTIME_MISMATCH: "Runtime mismatch", TelemetryFault.TOKEN_ACCOUNTING: "Retry token mismatch", TelemetryFault.FINAL_LABEL_LEAK: "Final-label leakage", TelemetryFault.RETRY_WITHOUT_DECISION: "Retry without decision"}
EXPECTED_VALID_FAULTS = frozenset((TelemetryFault.CLEAN, TelemetryFault.RECEIVE_REORDERING))


@dataclass(frozen=True, slots=True)
class TelemetryFaultRun:
    seed: int
    fault: TelemetryFault
    expected_valid: bool
    observed_valid: bool
    correct_behavior: bool
    error_count: int
    warning_count: int
    reconstructed_attempt_rate: float
    mean_runtime_fidelity_error_seconds: float
    mean_prediction_fidelity_error_seconds: float


@dataclass(frozen=True, slots=True)
class TelemetryFaultSummary:
    fault: TelemetryFault
    expected_valid: bool
    observed_valid_rate: float
    correct_behavior_rate: float
    error_count: MetricEstimate
    warning_count: MetricEstimate
    reconstructed_attempt_rate: MetricEstimate
    mean_runtime_fidelity_error_seconds: MetricEstimate
    mean_prediction_fidelity_error_seconds: MetricEstimate


@dataclass(frozen=True, slots=True)
class TelemetryIntegrityBenchmark:
    rows: tuple[TelemetryFaultRun, ...]
    summaries: tuple[TelemetryFaultSummary, ...]
    contract_gate_passed: bool


@dataclass(frozen=True, slots=True)
class TelemetryDelaySummary:
    delay_seconds: float
    valid_rate: float
    warning_event_rate: float
    mean_warning_count: float
    mean_error_count: float


def _replace_event(events: Sequence[TaskAttemptTelemetryEvent], target: TaskAttemptTelemetryEvent, **changes: object) -> tuple[TaskAttemptTelemetryEvent, ...]:
    return tuple(replace(event, **changes) if event.event_id == target.event_id else event for event in events)


def inject_telemetry_fault(events: Sequence[TaskAttemptTelemetryEvent], fault: TelemetryFault) -> tuple[TaskAttemptTelemetryEvent, ...]:
    if not events:
        raise ValueError("events must not be empty")
    selected = tuple(events)
    if fault is TelemetryFault.CLEAN:
        return selected
    if fault is TelemetryFault.RECEIVE_REORDERING:
        return tuple(replace(event, received_at=event.occurred_at + timedelta(seconds=(6 - min(event.sequence, 5)) * 0.1)) for event in selected)
    if fault is TelemetryFault.DUPLICATE_SOURCE_EVENT:
        return tuple([*selected, replace(selected[0], event_id=f"{selected[0].event_id}:duplicate")])
    if fault is TelemetryFault.MISSING_PREDICTION:
        target = next(event for event in selected if event.event_type is AttemptEventType.PREDICTED)
        return tuple(event for event in selected if event.event_id != target.event_id)
    if fault is TelemetryFault.SEQUENCE_GAP:
        target = next(event for event in selected if event.sequence == 2)
        return _replace_event(selected, target, sequence=target.sequence + 2)
    if fault is TelemetryFault.OCCURRED_TIME_REGRESSION:
        target = next(event for event in selected if event.event_type is AttemptEventType.STARTED)
        queued = next(event for event in selected if event.attempt_id == target.attempt_id and event.event_type is AttemptEventType.QUEUED)
        occurred_at = queued.occurred_at - timedelta(seconds=1)
        return _replace_event(selected, target, occurred_at=occurred_at, received_at=occurred_at + timedelta(seconds=0.1))
    if fault is TelemetryFault.EXCESSIVE_INGESTION_DELAY:
        target = selected[0]
        return _replace_event(selected, target, received_at=target.occurred_at + timedelta(seconds=301))
    if fault is TelemetryFault.FEATURE_SNAPSHOT_LEAK:
        target = next(event for event in selected if event.event_type is AttemptEventType.PREDICTED)
        data = {**target.data, "feature_snapshot_at": (target.occurred_at + timedelta(seconds=1)).isoformat()}
        return _replace_event(selected, target, data=data)
    if fault is TelemetryFault.SECRET_LEAK:
        target = next(event for event in selected if event.event_type is AttemptEventType.PREDICTED)
        return _replace_event(selected, target, data={**target.data, "delegation_token": "forbidden"})
    if fault is TelemetryFault.RUNTIME_MISMATCH:
        target = next(event for event in selected if event.event_type in (AttemptEventType.FAILED, AttemptEventType.COMPLETED))
        return _replace_event(selected, target, data={**target.data, "runtime_seconds": float(target.data["runtime_seconds"]) + 1.0})
    retry = next(event for event in selected if event.event_type is AttemptEventType.RETRY_DECIDED)
    if fault is TelemetryFault.TOKEN_ACCOUNTING:
        return _replace_event(selected, retry, data={**retry.data, "global_tokens_after": retry.data["global_tokens_before"]})
    if fault is TelemetryFault.FINAL_LABEL_LEAK:
        return _replace_event(selected, retry, data={**retry.data, "final_incident_kind": "provider_outage"})
    if fault is TelemetryFault.RETRY_WITHOUT_DECISION:
        return tuple(event for event in selected if event.event_id != retry.event_id)
    raise ValueError(f"unsupported telemetry fault: {fault}")


def _fidelity(expected: Sequence[ShadowTaskAttempt], actual: Sequence[ShadowTaskAttempt], field_name: str) -> float:
    expected_by_id = {item.attempt_id: float(getattr(item, field_name)) for item in expected}
    actual_by_id = {item.attempt_id: float(getattr(item, field_name)) for item in actual}
    common = expected_by_id.keys() & actual_by_id.keys()
    return 0.0 if not common else sum(abs(expected_by_id[key] - actual_by_id[key]) for key in common) / len(common)


def run_telemetry_integrity_benchmark(*, seeds: Sequence[int] = tuple(range(20)), task_count: int = 60, retry_rate: float = 0.25, faults: Sequence[TelemetryFault] = tuple(TelemetryFault)) -> TelemetryIntegrityBenchmark:
    if not seeds or not faults or task_count < 1:
        raise ValueError("benchmark seeds, faults and task count are invalid")
    rows: list[TelemetryFaultRun] = []
    for seed in seeds:
        clean_events, expected = generate_task_attempt_telemetry(task_count, retry_rate=retry_rate, random_seed=seed)
        for fault in faults:
            events = inject_telemetry_fault(clean_events, fault)
            report = validate_task_attempt_telemetry(events)
            expected_valid = fault in EXPECTED_VALID_FAULTS
            if report.is_valid:
                dataset = assemble_task_attempt_telemetry(events)
                reconstructed_rate = len(dataset.attempts) / len(expected)
                runtime_error = _fidelity(expected, dataset.attempts, "runtime_seconds")
                prediction_error = _fidelity(expected, dataset.attempts, "predicted_runtime_seconds")
            else:
                reconstructed_rate = 0.0
                runtime_error = 0.0
                prediction_error = 0.0
            rows.append(TelemetryFaultRun(seed=seed, fault=fault, expected_valid=expected_valid, observed_valid=report.is_valid, correct_behavior=report.is_valid == expected_valid, error_count=report.error_count, warning_count=report.warning_count, reconstructed_attempt_rate=reconstructed_rate, mean_runtime_fidelity_error_seconds=runtime_error, mean_prediction_fidelity_error_seconds=prediction_error))
    summaries: list[TelemetryFaultSummary] = []
    for fault in faults:
        selected = [row for row in rows if row.fault is fault]
        summaries.append(TelemetryFaultSummary(fault=fault, expected_valid=fault in EXPECTED_VALID_FAULTS, observed_valid_rate=sum(row.observed_valid for row in selected) / len(selected), correct_behavior_rate=sum(row.correct_behavior for row in selected) / len(selected), error_count=_estimate([float(row.error_count) for row in selected]), warning_count=_estimate([float(row.warning_count) for row in selected]), reconstructed_attempt_rate=_estimate([row.reconstructed_attempt_rate for row in selected]), mean_runtime_fidelity_error_seconds=_estimate([row.mean_runtime_fidelity_error_seconds for row in selected]), mean_prediction_fidelity_error_seconds=_estimate([row.mean_prediction_fidelity_error_seconds for row in selected])))
    contract_gate_passed = all(summary.correct_behavior_rate == 1.0 for summary in summaries) and all(summary.reconstructed_attempt_rate.mean == 1.0 and summary.mean_runtime_fidelity_error_seconds.mean == 0.0 and summary.mean_prediction_fidelity_error_seconds.mean == 0.0 for summary in summaries if summary.expected_valid)
    return TelemetryIntegrityBenchmark(rows=tuple(rows), summaries=tuple(summaries), contract_gate_passed=contract_gate_passed)


def run_telemetry_delay_benchmark(*, delays: Sequence[float] = (0.0, 10.0, 30.0, 60.0, 180.0, 300.0, 301.0, 600.0), seeds: Sequence[int] = tuple(range(10)), task_count: int = 30) -> tuple[TelemetryDelaySummary, ...]:
    if not delays or not seeds or any(delay < 0 for delay in delays):
        raise ValueError("delay benchmark values are invalid")
    summaries: list[TelemetryDelaySummary] = []
    for delay in delays:
        reports = []
        for seed in seeds:
            events, _ = generate_task_attempt_telemetry(task_count, retry_rate=0.25, random_seed=seed)
            delayed = tuple(replace(event, received_at=event.occurred_at + timedelta(seconds=delay)) for event in events)
            reports.append(validate_task_attempt_telemetry(delayed))
        event_count = sum(report.event_count for report in reports)
        summaries.append(TelemetryDelaySummary(delay_seconds=delay, valid_rate=sum(report.is_valid for report in reports) / len(reports), warning_event_rate=sum(report.warning_count for report in reports) / event_count, mean_warning_count=sum(report.warning_count for report in reports) / len(reports), mean_error_count=sum(report.error_count for report in reports) / len(reports)))
    return tuple(summaries)
