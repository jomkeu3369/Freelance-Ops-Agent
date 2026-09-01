from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from .scheduler_simulation import SchedulerTask, SchedulingPolicy, simulate_scheduler
from .shadow_replay import SHADOW_REPLAY_SCHEMA_VERSION, ShadowReplayValidationError, ShadowTaskAttempt, load_shadow_replay_jsonl, run_shadow_replay, validate_shadow_replay, write_shadow_replay_jsonl


ANCHOR = datetime(2026, 8, 27, tzinfo=UTC)


def _record(attempt_id: str = "attempt-1", task_id: str = "task-1", *, attempt_number: int = 1, queued: float = 0.0, started: float = 5.0, completed: float = 15.0, predicted_at: float = 0.0, feature_at: float = 0.0, runtime: float = 10.0, workspace_id: str = "workspace", task_type: str = "code_review", model: str = "gpt", success: bool = True) -> ShadowTaskAttempt:
    return ShadowTaskAttempt(schema_version=SHADOW_REPLAY_SCHEMA_VERSION, attempt_id=attempt_id, task_id=task_id, attempt_number=attempt_number, workspace_id=workspace_id, task_type=task_type, model=model, input_tokens=1_000, context_tokens=2_000, file_count=3, subagent_depth=1, priority=3, queued_at=ANCHOR + timedelta(seconds=queued), started_at=ANCHOR + timedelta(seconds=started), completed_at=ANCHOR + timedelta(seconds=completed), feature_snapshot_at=ANCHOR + timedelta(seconds=feature_at), predicted_at=ANCHOR + timedelta(seconds=predicted_at), predicted_runtime_seconds=9.0, predictor_version="predictor-v1", runtime_seconds=runtime, success=success)


def test_shadow_jsonl_round_trip_preserves_record(tmp_path) -> None:
    path = tmp_path / "shadow.jsonl"
    original = _record(task_type="never_seen_type", model="never_seen_model")
    write_shadow_replay_jsonl(tuple([original]), path)
    loaded, report = load_shadow_replay_jsonl(path, worker_count=1)
    assert loaded == tuple([original])
    assert report.is_valid


def test_validator_rejects_post_queue_feature_and_prediction() -> None:
    record = _record(predicted_at=1.0, feature_at=1.0)
    report = validate_shadow_replay(tuple([record]), worker_count=1)
    assert not report.is_valid
    assert any("no later than queued_at" in issue.message for issue in report.issues)


def test_validator_rejects_runtime_timestamp_mismatch() -> None:
    report = validate_shadow_replay(tuple([_record(runtime=9.0)]), worker_count=1)
    assert not report.is_valid
    assert any("runtime_seconds" in issue.message for issue in report.issues)


def test_validator_rejects_observed_concurrency_above_worker_count() -> None:
    records = (_record("attempt-1", "task-1"), _record("attempt-2", "task-2"))
    report = validate_shadow_replay(records, worker_count=1)
    assert not report.is_valid
    assert report.maximum_observed_concurrency == 2


def test_strict_loader_raises_structured_validation_error(tmp_path) -> None:
    path = tmp_path / "invalid.jsonl"
    write_shadow_replay_jsonl(tuple([_record(runtime=9.0)]), path)
    with pytest.raises(ShadowReplayValidationError) as raised:
        load_shadow_replay_jsonl(path, worker_count=1)
    assert raised.value.report.error_count == 1


def test_loader_rejects_string_boolean(tmp_path) -> None:
    path = tmp_path / "invalid-boolean.jsonl"
    write_shadow_replay_jsonl(tuple([_record()]), path)
    path.write_text(path.read_text(encoding="utf-8").replace('"success":true', '"success":"false"'), encoding="utf-8")
    with pytest.raises(ShadowReplayValidationError) as raised:
        load_shadow_replay_jsonl(path, worker_count=1)
    assert "must be booleans" in str(raised.value)


def test_empty_dataset_is_invalid() -> None:
    report = validate_shadow_replay((), worker_count=1)
    assert not report.is_valid


def test_observed_fifo_matches_fifo_counterfactual_on_fixture() -> None:
    tasks = [SchedulerTask(task_id=f"task-{index}", workspace_id="workspace", queued_at_seconds=0.0, actual_runtime_seconds=runtime, predicted_runtime_seconds=runtime, priority=3) for index, runtime in enumerate((20.0, 5.0, 10.0))]
    observed = simulate_scheduler(tasks, SchedulingPolicy.FIFO, worker_count=1)
    by_id = {task.task_id: task for task in tasks}
    records = tuple(replace(_record(attempt_id=result.task_id, task_id=result.task_id, queued=result.queued_at_seconds, started=result.started_at_seconds, completed=result.completed_at_seconds, runtime=result.actual_runtime_seconds), predicted_runtime_seconds=result.predicted_runtime_seconds) for result in observed.task_results)
    replay = run_shadow_replay(records, worker_count=1, policies=(SchedulingPolicy.FIFO, SchedulingPolicy.GLOBAL_PREDICTED_SJF))
    observed_metrics = replay.results[0].metrics
    fifo_metrics = replay.results[1].metrics
    assert observed_metrics.mean_wait_seconds == fifo_metrics.mean_wait_seconds
    assert observed_metrics.p95_completion_seconds == fifo_metrics.p95_completion_seconds
    assert replay.results[2].metrics.mean_completion_seconds < fifo_metrics.mean_completion_seconds
    assert set(by_id) == {record.task_id for record in records}


def test_runtime_and_queue_wait_are_separate_replay_values() -> None:
    record = _record(started=20.0, completed=30.0, runtime=10.0)
    replay = run_shadow_replay(tuple([record]), worker_count=1, policies=tuple([SchedulingPolicy.FIFO]))
    assert record.queue_wait_seconds == 20.0
    assert record.runtime_seconds == 10.0
    assert replay.results[0].metrics.mean_completion_seconds == 30.0


def test_retry_attempt_must_follow_previous_completion() -> None:
    first = _record("attempt-1", "task", attempt_number=1, queued=0.0, started=0.0, completed=10.0)
    second = replace(_record("attempt-2", "task", attempt_number=2, queued=5.0, started=10.0, completed=20.0), retry_reason="provider_error")
    report = validate_shadow_replay((first, second), worker_count=1)
    assert not report.is_valid
    assert any("previous attempt completes" in issue.message for issue in report.issues)
