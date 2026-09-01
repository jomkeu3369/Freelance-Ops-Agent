"""Deterministic FIFO dispatch with hierarchical scheduler shadow decisions."""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID


class SchedulerQueueKind(StrEnum):
    READY = "READY"
    RETRY = "RETRY"


class ShadowAdmissionDecision(StrEnum):
    ADMIT = "ADMIT"
    DEFER = "DEFER"
    REJECT = "REJECT"


class ShadowAdmissionReason(StrEnum):
    CAPACITY_AVAILABLE = "CAPACITY_AVAILABLE"
    SCALE_REQUIRED = "SCALE_REQUIRED"
    GLOBAL_DRAIN_EXCEEDED = "GLOBAL_DRAIN_EXCEEDED"
    WORKSPACE_BURST_EXCEEDED = "WORKSPACE_BURST_EXCEEDED"
    MAXIMUM_DEFER_EXCEEDED = "MAXIMUM_DEFER_EXCEEDED"


class ShadowSchedulingLane(StrEnum):
    HIGH_PRIORITY_RESCUE = "HIGH_PRIORITY_RESCUE"
    BOUNDED_AGING_RESCUE = "BOUNDED_AGING_RESCUE"
    PREDICTED_SJF = "PREDICTED_SJF"


@dataclass(frozen=True, slots=True)
class SchedulerPolicy:
    policy_version: str = "scheduler-shadow-v1"
    actual_policy_version: str = "fifo-v1"
    global_drain_limit_seconds: float = 120
    priority_wait_slo_seconds: float = 60
    high_priority_rescue_seconds: float = 45
    maximum_wait_seconds: float = 120
    maximum_defer_seconds: float = 600
    emergency_drain_seconds: float = 300
    workspace_burst_work_seconds: float = 240
    scale_factor: float = 2
    aging_rate: float = 0.02
    aging_overdue_interval: int = 4
    high_priority_threshold: int = 4
    low_priority_threshold: int = 2

    def __post_init__(self) -> None:
        positive = (self.global_drain_limit_seconds, self.priority_wait_slo_seconds, self.high_priority_rescue_seconds, self.maximum_wait_seconds, self.maximum_defer_seconds, self.emergency_drain_seconds, self.workspace_burst_work_seconds, self.scale_factor)
        if not self.policy_version.strip() or not self.actual_policy_version.strip() or any(value <= 0 for value in positive):
            raise ValueError("scheduler policy versions and thresholds must be positive")
        if self.aging_rate < 0 or self.aging_overdue_interval < 1 or not 1 <= self.low_priority_threshold < self.high_priority_threshold <= 5:
            raise ValueError("scheduler aging and priority thresholds are invalid")


@dataclass(frozen=True, slots=True)
class WorkerCapacitySnapshot:
    resource_pool: str
    worker_count: int
    captured_at: datetime

    def __post_init__(self) -> None:
        if not self.resource_pool.strip() or self.worker_count < 1:
            raise ValueError("worker capacity snapshot is invalid")
        _require_timezone(self.captured_at, "capacity captured_at")


@dataclass(frozen=True, slots=True)
class SchedulerCandidate:
    attempt_id: UUID
    task_id: UUID
    task_revision: int
    workspace_id: UUID
    resource_pool: str
    priority: int
    predicted_runtime_seconds: float
    predictor_version: str
    queue_kind: SchedulerQueueKind
    enqueued_at: datetime
    available_at: datetime

    def __post_init__(self) -> None:
        if self.task_revision < 1 or not self.resource_pool.strip() or not 1 <= self.priority <= 5 or self.predicted_runtime_seconds < 0 or not self.predictor_version.strip():
            raise ValueError("scheduler candidate values are invalid")
        _require_timezone(self.enqueued_at, "candidate enqueued_at")
        _require_timezone(self.available_at, "candidate available_at")
        if self.available_at < self.enqueued_at:
            raise ValueError("scheduler candidate cannot be available before enqueue")


@dataclass(frozen=True, slots=True)
class ShadowAdmissionSnapshot:
    decision: ShadowAdmissionDecision
    reason: ShadowAdmissionReason
    global_drain_seconds: float
    workspace_drain_seconds: float
    priority_drain_seconds: float
    scale_requested: bool
    projected_worker_count: int
    shadow_available_at: datetime | None
    policy_version: str


@dataclass(frozen=True, slots=True)
class SchedulerRank:
    attempt_id: UUID
    actual_rank: int
    shadow_rank: int
    shadow_score: float
    shadow_lane: ShadowSchedulingLane


class HierarchicalShadowScheduler:
    def __init__(self, policy: SchedulerPolicy | None = None) -> None:
        self.policy = policy or SchedulerPolicy()

    def assess(self, candidate: SchedulerCandidate, pending: list[SchedulerCandidate], capacity: WorkerCapacitySnapshot) -> ShadowAdmissionSnapshot:
        candidates = [*pending, candidate]
        workers = capacity.worker_count
        global_work = sum(item.predicted_runtime_seconds for item in candidates)
        workspace_work = sum(item.predicted_runtime_seconds for item in candidates if item.workspace_id == candidate.workspace_id)
        priority_work = sum(item.predicted_runtime_seconds for item in candidates if item.priority >= self.policy.high_priority_threshold)
        workspace_count = len({item.workspace_id for item in candidates})
        global_drain = global_work / workers
        workspace_drain = workspace_work / (workers / workspace_count)
        priority_drain = priority_work / workers
        overload = global_drain > self.policy.global_drain_limit_seconds or priority_drain > self.policy.priority_wait_slo_seconds
        projected_workers = max(workers + 1, round(workers * self.policy.scale_factor)) if overload else workers
        scale_resolves = overload and global_work / projected_workers <= self.policy.emergency_drain_seconds
        workspace_delay = max(0.0, (workspace_work - self.policy.workspace_burst_work_seconds) / (workers / workspace_count))
        global_delay = max(0.0, global_drain - self.policy.global_drain_limit_seconds)
        delay = max(global_delay, workspace_delay)
        if not overload and delay <= 0:
            decision, reason = ShadowAdmissionDecision.ADMIT, ShadowAdmissionReason.CAPACITY_AVAILABLE
        elif scale_resolves or candidate.priority >= self.policy.high_priority_threshold:
            decision, reason = ShadowAdmissionDecision.ADMIT, ShadowAdmissionReason.SCALE_REQUIRED
        elif candidate.priority <= self.policy.low_priority_threshold:
            decision, reason = ShadowAdmissionDecision.REJECT, ShadowAdmissionReason.GLOBAL_DRAIN_EXCEEDED
        elif delay <= self.policy.maximum_defer_seconds:
            decision = ShadowAdmissionDecision.DEFER
            reason = ShadowAdmissionReason.WORKSPACE_BURST_EXCEEDED if workspace_delay >= global_delay else ShadowAdmissionReason.GLOBAL_DRAIN_EXCEEDED
        else:
            decision, reason = ShadowAdmissionDecision.REJECT, ShadowAdmissionReason.MAXIMUM_DEFER_EXCEEDED
        shadow_available_at = candidate.enqueued_at + timedelta(seconds=delay) if decision is ShadowAdmissionDecision.DEFER else None
        return ShadowAdmissionSnapshot(decision, reason, global_drain, workspace_drain, priority_drain, overload, projected_workers, shadow_available_at, self.policy.policy_version)

    def rank(self, candidates: list[SchedulerCandidate], now: datetime, *, dispatch_count: int = 0) -> list[SchedulerRank]:
        _require_timezone(now, "scheduler rank time")
        eligible = [candidate for candidate in candidates if candidate.available_at <= now]
        actual = sorted(eligible, key=lambda candidate: (candidate.available_at, candidate.enqueued_at, str(candidate.attempt_id)))
        actual_ranks = {candidate.attempt_id: index for index, candidate in enumerate(actual, start=1)}
        shadow = sorted(eligible, key=lambda candidate: self._shadow_key(candidate, now, dispatch_count))
        shadow_ranks = {candidate.attempt_id: index for index, candidate in enumerate(shadow, start=1)}
        return [SchedulerRank(candidate.attempt_id, actual_ranks[candidate.attempt_id], shadow_ranks[candidate.attempt_id], self._score(candidate, now), self._lane(candidate, now, dispatch_count)) for candidate in actual]

    def _shadow_key(self, candidate: SchedulerCandidate, now: datetime, dispatch_count: int) -> tuple[float, float, datetime, str]:
        lane = self._lane(candidate, now, dispatch_count)
        lane_rank = {ShadowSchedulingLane.HIGH_PRIORITY_RESCUE: 0.0, ShadowSchedulingLane.BOUNDED_AGING_RESCUE: 1.0, ShadowSchedulingLane.PREDICTED_SJF: 2.0}[lane]
        return lane_rank, self._score(candidate, now), candidate.enqueued_at, str(candidate.attempt_id)

    def _lane(self, candidate: SchedulerCandidate, now: datetime, dispatch_count: int) -> ShadowSchedulingLane:
        wait = max(0.0, (now - candidate.enqueued_at).total_seconds())
        if candidate.priority >= self.policy.high_priority_threshold and wait >= self.policy.high_priority_rescue_seconds:
            return ShadowSchedulingLane.HIGH_PRIORITY_RESCUE
        if wait >= self.policy.maximum_wait_seconds and dispatch_count % self.policy.aging_overdue_interval == self.policy.aging_overdue_interval - 1:
            return ShadowSchedulingLane.BOUNDED_AGING_RESCUE
        return ShadowSchedulingLane.PREDICTED_SJF

    def _score(self, candidate: SchedulerCandidate, now: datetime) -> float:
        wait = max(0.0, (now - candidate.enqueued_at).total_seconds())
        return candidate.predicted_runtime_seconds / (1 + 0.25 * (candidate.priority - 1) + self.policy.aging_rate * wait)


def _require_timezone(value: datetime, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
