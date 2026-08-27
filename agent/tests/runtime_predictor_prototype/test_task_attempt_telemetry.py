from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

import pytest

from .task_attempt_telemetry import AttemptEventType, RetryDecisionReason, TaskAttemptTelemetryValidationError, assemble_task_attempt_telemetry, generate_task_attempt_telemetry, load_task_attempt_telemetry_jsonl, validate_task_attempt_telemetry, write_task_attempt_telemetry_jsonl


def test_clean_telemetry_reconstructs_attempts_and_retry_decisions() -> None:
    events, expected = generate_task_attempt_telemetry(40, retry_rate=0.25, random_seed=3)
    dataset = assemble_task_attempt_telemetry(events)
    assert dataset.validation.is_valid
    assert dataset.attempts == expected
    assert len(dataset.retry_decisions) > 0
    retry_attempts = [attempt for attempt in dataset.attempts if attempt.attempt_number > 1]
    assert all(attempt.retry_reason == RetryDecisionReason.RETRY_ALLOWED.value for attempt in retry_attempts)


def test_jsonl_round_trip_preserves_reconstructed_dataset(tmp_path) -> None:
    events, expected = generate_task_attempt_telemetry(20, retry_rate=0.30, random_seed=5)
    path = tmp_path / "task-attempt-events.jsonl"
    write_task_attempt_telemetry_jsonl(events, path)
    loaded = load_task_attempt_telemetry_jsonl(path)
    assert loaded.attempts == expected
    assert loaded.validation.is_valid


def test_receive_reordering_is_tolerated_when_source_sequence_is_valid() -> None:
    events, expected = generate_task_attempt_telemetry(10, retry_rate=0.20, random_seed=7)
    anchor = max(event.received_at for event in events)
    reordered = tuple(replace(event, received_at=max(event.occurred_at, anchor - timedelta(milliseconds=event.sequence))) for event in events)
    dataset = assemble_task_attempt_telemetry(reordered)
    assert dataset.validation.is_valid
    assert dataset.attempts == expected


def test_validator_rejects_duplicate_source_event_and_sequence_gap() -> None:
    events, _ = generate_task_attempt_telemetry(5, retry_rate=0.20, random_seed=11)
    duplicated = tuple([*events, replace(events[0], event_id="duplicate-event")])
    duplicate_report = validate_task_attempt_telemetry(duplicated)
    assert not duplicate_report.is_valid
    assert duplicate_report.duplicate_source_event_count == 1
    target = next(event for event in events if event.sequence == 2)
    gapped = tuple(replace(event, sequence=4) if event.event_id == target.event_id else event for event in events)
    gap_report = validate_task_attempt_telemetry(gapped)
    assert not gap_report.is_valid
    assert any("contiguous" in issue.message for issue in gap_report.issues)


def test_validator_rejects_prediction_leak_secret_and_runtime_mismatch() -> None:
    events, _ = generate_task_attempt_telemetry(5, retry_rate=0.20, random_seed=13)
    prediction = next(event for event in events if event.event_type is AttemptEventType.PREDICTED)
    leaked_data = {**prediction.data, "delegation_token": "must-not-persist"}
    leaked = tuple(replace(event, data=leaked_data) if event.event_id == prediction.event_id else event for event in events)
    leak_report = validate_task_attempt_telemetry(leaked)
    assert not leak_report.is_valid
    assert any("forbidden" in issue.message for issue in leak_report.issues)
    terminal = next(event for event in events if event.event_type in (AttemptEventType.FAILED, AttemptEventType.COMPLETED))
    invalid_runtime = tuple(replace(event, data={**event.data, "runtime_seconds": float(event.data["runtime_seconds"]) + 1.0}) if event.event_id == terminal.event_id else event for event in events)
    runtime_report = validate_task_attempt_telemetry(invalid_runtime)
    assert not runtime_report.is_valid
    assert any("runtime_seconds" in issue.message for issue in runtime_report.issues)


def test_validator_rejects_retry_token_accounting_and_final_label_leakage() -> None:
    events, _ = generate_task_attempt_telemetry(10, retry_rate=1.0, random_seed=17)
    decision = next(event for event in events if event.event_type is AttemptEventType.RETRY_DECIDED)
    invalid_tokens = {**decision.data, "workspace_tokens_after": decision.data["workspace_tokens_before"]}
    token_events = tuple(replace(event, data=invalid_tokens) if event.event_id == decision.event_id else event for event in events)
    token_report = validate_task_attempt_telemetry(token_events)
    assert not token_report.is_valid
    assert any("consume one workspace" in issue.message for issue in token_report.issues)
    leaked_label = {**decision.data, "final_incident_kind": "provider_outage"}
    label_events = tuple(replace(event, data=leaked_label) if event.event_id == decision.event_id else event for event in events)
    label_report = validate_task_attempt_telemetry(label_events)
    assert not label_report.is_valid
    assert any("final labels" in issue.message for issue in label_report.issues)


def test_retry_attempt_requires_allowed_prior_decision() -> None:
    events, _ = generate_task_attempt_telemetry(10, retry_rate=1.0, random_seed=19)
    decision = next(event for event in events if event.event_type is AttemptEventType.RETRY_DECIDED)
    missing = tuple(event for event in events if event.event_id != decision.event_id)
    report = validate_task_attempt_telemetry(missing)
    assert not report.is_valid
    assert any("allowed prior retry decision" in issue.message for issue in report.issues)
    with pytest.raises(TaskAttemptTelemetryValidationError):
        assemble_task_attempt_telemetry(missing)


def test_ingestion_delay_has_warning_and_hard_replay_boundaries() -> None:
    events, _ = generate_task_attempt_telemetry(5, retry_rate=0.20, random_seed=23)
    target = events[0]
    warning_events = tuple(replace(event, received_at=event.occurred_at + timedelta(seconds=60)) if event.event_id == target.event_id else event for event in events)
    warning_report = validate_task_attempt_telemetry(warning_events)
    assert warning_report.is_valid
    assert warning_report.warning_count == 1
    late_events = tuple(replace(event, received_at=event.occurred_at + timedelta(seconds=301)) if event.event_id == target.event_id else event for event in events)
    late_report = validate_task_attempt_telemetry(late_events)
    assert not late_report.is_valid
    assert any("exceeds replay limit" in issue.message for issue in late_report.issues)
