# ruff: noqa: E501, I001

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from runtime import RuntimeEvaluationPolicy, RuntimeReleaseStatus, SchedulerEvaluationMetrics, TaskAttemptEvaluationRecord, TerminalObservationCoverage, evaluate_runtime_release, runtime_dataset_fingerprint


def test_terminal_observation_coverage_uses_registered_terminal_attempts_as_denominator() -> None:
    coverage = TerminalObservationCoverage(10, 9, 8)

    assert coverage.observation_coverage == 0.9
    assert coverage.delivery_coverage == 0.8


def records() -> list[TaskAttemptEvaluationRecord]:
    start = datetime(2026, 8, 1, tzinfo=UTC)
    workspace_a = uuid4()
    workspace_b = uuid4()
    values = []
    for index, runtime in enumerate((10.0, 20.0, 30.0, 40.0)):
        queued = start + timedelta(days=index)
        started = queued + timedelta(seconds=5)
        values.append(TaskAttemptEvaluationRecord(uuid4(), uuid4(), workspace_a if index % 2 == 0 else workspace_b, 1, 5 if index == 0 else 3, "default", queued, started, started + timedelta(seconds=runtime), runtime, "predictor-v1", True))
    return values


def policy() -> RuntimeEvaluationPolicy:
    return RuntimeEvaluationPolicy(minimum_attempts=4, minimum_observation_days=3, minimum_load_bands=1, maximum_mae_seconds=1, maximum_p95_absolute_error_seconds=1, minimum_r2=0.99)


def passing_shadow() -> SchedulerEvaluationMetrics:
    return SchedulerEvaluationMetrics(1, 1, 1, 1, 5)


def test_release_remains_shadow_only_without_counterfactual_scheduler_metrics() -> None:
    report = evaluate_runtime_release(records(), load_band_count=1, policy=policy())

    assert report.status is RuntimeReleaseStatus.SHADOW_ONLY
    assert next(gate for gate in report.gates if gate.name == "shadow_metrics_available").passed is False


def test_release_is_approved_only_when_every_data_predictor_and_scheduler_gate_passes() -> None:
    report = evaluate_runtime_release(records(), load_band_count=1, shadow_scheduler=passing_shadow(), policy=policy())

    assert report.status is RuntimeReleaseStatus.APPROVED
    assert report.predictor.mae_seconds == 0
    assert report.predictor.r2 == 1
    assert all(gate.passed for gate in report.gates)


def test_missing_timestamp_and_predictor_regression_fail_closed() -> None:
    selected = records()
    first = selected[0]
    selected[0] = TaskAttemptEvaluationRecord(first.attempt_id, first.task_id, first.workspace_id, first.attempt_number, first.priority, first.resource_pool, first.queued_at, None, first.finished_at, 100, first.predictor_version, first.succeeded)
    second = selected[1]
    selected[1] = TaskAttemptEvaluationRecord(second.attempt_id, second.task_id, second.workspace_id, second.attempt_number, second.priority, second.resource_pool, second.queued_at, second.started_at, second.finished_at, 100, second.predictor_version, second.succeeded)

    report = evaluate_runtime_release(selected, load_band_count=1, shadow_scheduler=passing_shadow(), policy=policy())

    assert report.status is RuntimeReleaseStatus.SHADOW_ONLY
    assert report.required_field_missing_count == 1
    assert next(gate for gate in report.gates if gate.name == "predictor_mae_seconds").passed is False


def test_dataset_fingerprint_is_order_independent_and_observation_gaps_block_release() -> None:
    selected = records()

    report = evaluate_runtime_release(selected, load_band_count=1, source_terminal_count=5, shadow_scheduler=passing_shadow(), policy=policy())

    assert runtime_dataset_fingerprint(selected) == runtime_dataset_fingerprint(list(reversed(selected)))
    assert report.status is RuntimeReleaseStatus.SHADOW_ONLY
    assert report.scheduler_observation_coverage == 0.8
