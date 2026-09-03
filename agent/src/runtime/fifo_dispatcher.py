"""Bounded FIFO dispatcher boundary for the read-only Research pilot."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid5

from .scheduler import SchedulerCandidate, SchedulerQueueKind, WorkerCapacitySnapshot
from .task_contracts import DepartmentTask, TaskAttempt
from .task_scheduler_store import ClaimedSchedulerEntry, PostgresShadowSchedulerStore, SchedulerObservation


class FifoDispatchSink(Protocol):
    @property
    def has_capacity(self) -> bool: ...

    async def dispatch(self, claim: ClaimedSchedulerEntry, *, acknowledge: Callable[[], Awaitable[None]]) -> bool: ...


class ResearchFifoDispatcherPilot:
    PROFILE = "research-read-v1"

    def __init__(self, store: PostgresShadowSchedulerStore, sink: FifoDispatchSink, *, resource_pool: str, claimed_by: str, lease_seconds: int = 60, predicted_runtime_seconds: float = 30, predictor_version: str = "pilot-static-v1", worker_count: int = 1) -> None:  # noqa: E501
        if not resource_pool.strip() or not claimed_by.strip() or not 1 <= lease_seconds <= 300 or predicted_runtime_seconds < 0 or not predictor_version.strip() or worker_count < 1:  # noqa: E501
            raise ValueError("Research FIFO dispatcher configuration is invalid")
        self._store = store
        self._sink = sink
        self._resource_pool = resource_pool
        self._claimed_by = claimed_by
        self._lease_seconds = lease_seconds
        self._predicted_runtime_seconds = predicted_runtime_seconds
        self._predictor_version = predictor_version
        self._worker_count = worker_count

    @property
    def prediction(self) -> tuple[float, str]:
        return self._predicted_runtime_seconds, self._predictor_version

    def capacity(self, captured_at: datetime) -> WorkerCapacitySnapshot:
        return WorkerCapacitySnapshot(self._resource_pool, self._worker_count, captured_at)

    async def observe_queued(self, task: DepartmentTask, attempt: TaskAttempt, capacity: WorkerCapacitySnapshot) -> SchedulerObservation:  # noqa: E501
        if task.execution.specialist_profile != self.PROFILE:
            raise ValueError("Research FIFO dispatcher profile is not allowed")
        if capacity.resource_pool != self._resource_pool:
            raise ValueError("Research FIFO dispatcher resource pool is invalid")
        if attempt.task_id != task.task_id or attempt.task_revision != task.revision or attempt.workspace_id != task.workspace_id or attempt.run_id != task.run_id:  # noqa: E501
            raise ValueError("Research FIFO dispatcher identity is invalid")
        if attempt.predicted_service_runtime_seconds is None or attempt.predictor_version is None:
            raise ValueError("Research FIFO dispatcher requires a versioned prediction")
        if (attempt.predicted_service_runtime_seconds, attempt.predictor_version) != self.prediction:
            raise ValueError("Research FIFO dispatcher prediction is invalid")
        queued_at = attempt.queued_at or task.created_at
        candidate = SchedulerCandidate(attempt.attempt_id, task.task_id, task.revision, task.workspace_id, self._resource_pool, task.priority, attempt.predicted_service_runtime_seconds, attempt.predictor_version, SchedulerQueueKind.READY, queued_at, queued_at)  # noqa: E501
        await self._store.record_capacity(uuid5(attempt.attempt_id, f"capacity:{capacity.captured_at.isoformat()}"), capacity, source="fifo-dispatcher-pilot")  # noqa: E501
        return await self._store.observe_queued(candidate, capacity)

    async def dispatch_once(self, *, now: datetime | None = None) -> ClaimedSchedulerEntry | None:
        if not self._sink.has_capacity:
            return None
        claim = await self._store.claim_next(self._resource_pool, self._claimed_by, now or datetime.now(UTC), lease_seconds=self._lease_seconds)  # noqa: E501
        if claim is None:
            return None
        async def acknowledge() -> None:
            await self._store.acknowledge_dispatch(claim.candidate.attempt_id, claim.claim_id, self._claimed_by)
        await self._sink.dispatch(claim, acknowledge=acknowledge)
        return claim
