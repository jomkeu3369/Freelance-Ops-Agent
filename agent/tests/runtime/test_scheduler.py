# ruff: noqa: ANN001, E501, I001

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from runtime import HierarchicalShadowScheduler, SchedulerCandidate, SchedulerPolicy, SchedulerQueueKind, ShadowAdmissionDecision, ShadowAdmissionReason, ShadowSchedulingLane, WorkerCapacitySnapshot


def candidate(runtime: float, *, priority: int = 3, queued_seconds_ago: float = 0, available_in_seconds: float = 0, workspace_id=None) -> SchedulerCandidate:  # noqa: ANN001
    now = datetime.now(UTC)
    enqueued_at = now - timedelta(seconds=queued_seconds_ago)
    return SchedulerCandidate(uuid4(), uuid4(), 1, uuid4() if workspace_id is None else workspace_id, "default", priority, runtime, "predictor-v1", SchedulerQueueKind.READY, enqueued_at, enqueued_at + timedelta(seconds=available_in_seconds))


def test_shadow_admission_requests_scale_without_changing_actual_fifo_policy() -> None:
    scheduler = HierarchicalShadowScheduler()
    selected = candidate(500, priority=5)
    capacity = WorkerCapacitySnapshot("default", 2, datetime.now(UTC))

    snapshot = scheduler.assess(selected, [], capacity)

    assert scheduler.policy.actual_policy_version == "fifo-v1"
    assert snapshot.decision is ShadowAdmissionDecision.ADMIT
    assert snapshot.reason is ShadowAdmissionReason.SCALE_REQUIRED
    assert snapshot.scale_requested is True
    assert snapshot.projected_worker_count == 4


def test_shadow_admission_rejects_low_priority_work_when_even_scaled_capacity_is_infeasible() -> None:
    scheduler = HierarchicalShadowScheduler()

    snapshot = scheduler.assess(candidate(2_000, priority=1), [], WorkerCapacitySnapshot("default", 2, datetime.now(UTC)))

    assert snapshot.decision is ShadowAdmissionDecision.REJECT
    assert snapshot.reason is ShadowAdmissionReason.GLOBAL_DRAIN_EXCEEDED


def test_actual_fifo_rank_is_preserved_while_shadow_prefers_short_work() -> None:
    scheduler = HierarchicalShadowScheduler()
    older_long = candidate(90, queued_seconds_ago=10)
    newer_short = candidate(5, queued_seconds_ago=5)

    ranks = {rank.attempt_id: rank for rank in scheduler.rank([newer_short, older_long], datetime.now(UTC))}

    assert ranks[older_long.attempt_id].actual_rank == 1
    assert ranks[newer_short.attempt_id].shadow_rank == 1


def test_high_priority_waiting_task_enters_rescue_lane() -> None:
    scheduler = HierarchicalShadowScheduler()
    rescue = candidate(90, priority=5, queued_seconds_ago=50)
    short = candidate(1, priority=3, queued_seconds_ago=5)

    ranks = {rank.attempt_id: rank for rank in scheduler.rank([short, rescue], datetime.now(UTC))}

    assert ranks[rescue.attempt_id].shadow_rank == 1
    assert ranks[rescue.attempt_id].shadow_lane is ShadowSchedulingLane.HIGH_PRIORITY_RESCUE


def test_retry_entry_is_not_ranked_before_available_at() -> None:
    scheduler = HierarchicalShadowScheduler()
    unavailable = candidate(1, available_in_seconds=30)
    ready = candidate(10)

    ranks = scheduler.rank([unavailable, ready], datetime.now(UTC))

    assert [rank.attempt_id for rank in ranks] == [ready.attempt_id]


def test_scheduler_policy_rejects_invalid_priority_thresholds() -> None:
    with pytest.raises(ValueError, match="priority"):
        SchedulerPolicy(low_priority_threshold=4, high_priority_threshold=4)
