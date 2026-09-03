from __future__ import annotations

# ruff: noqa: E501, I001

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from contracts import DepartmentName, ModelSelection, Provider, RunBudget
from runtime import ClaimedSchedulerEntry, DepartmentTask, ExecutionRoute, ResearchFifoDispatcherPilot, SchedulerCandidate, SchedulerQueueKind, SchedulerRank, ShadowSchedulingLane, TaskAttempt, TaskExecutionSnapshot, WorkerCapacitySnapshot


class RecordingStore:
    def __init__(self, claim: ClaimedSchedulerEntry | None = None) -> None:
        self.claim = claim
        self.capacities: list[WorkerCapacitySnapshot] = []
        self.candidates: list[SchedulerCandidate] = []
        self.acknowledged: list[tuple[object, object, str]] = []

    async def record_capacity(self, event_id: object, snapshot: WorkerCapacitySnapshot, *, source: str) -> WorkerCapacitySnapshot:
        del event_id, source
        self.capacities.append(snapshot)
        return snapshot

    async def observe_queued(self, candidate: SchedulerCandidate, capacity: WorkerCapacitySnapshot) -> object:
        del capacity
        self.candidates.append(candidate)
        return object()

    async def claim_next(self, resource_pool: str, claimed_by: str, now: datetime, *, lease_seconds: int = 60, dispatch_count: int = 0) -> ClaimedSchedulerEntry | None:
        del resource_pool, claimed_by, now, lease_seconds, dispatch_count
        return self.claim

    async def acknowledge_dispatch(self, attempt_id: object, claim_id: object, claimed_by: str) -> None:
        self.acknowledged.append((attempt_id, claim_id, claimed_by))


class FailingAckStore(RecordingStore):
    async def acknowledge_dispatch(self, attempt_id: object, claim_id: object, claimed_by: str) -> None:
        del attempt_id, claim_id, claimed_by
        raise RuntimeError("simulated ACK loss")


class RecordingSink:
    has_capacity = True

    def __init__(self, accepted: bool) -> None:
        self.accepted = accepted
        self.claims: list[ClaimedSchedulerEntry] = []

    async def dispatch(self, claim: ClaimedSchedulerEntry, *, acknowledge: Callable[[], Awaitable[None]]) -> bool:
        self.claims.append(claim)
        if self.accepted:
            await acknowledge()
        return self.accepted


def fixture() -> tuple[DepartmentTask, TaskAttempt, WorkerCapacitySnapshot, ClaimedSchedulerEntry]:
    now = datetime.now(UTC)
    budget = RunBudget(max_duration_seconds=60, max_model_calls=2, max_tool_calls=2, max_input_tokens=1000, max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1)
    execution = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=["agent.run", "project.read"], budget=budget, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", specialist_profile="research-read-v1")
    task = DepartmentTask(task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), project_id=uuid4(), department=DepartmentName.RESEARCH, revision=1, execution=execution, created_at=now)
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=1, attempt_number=1, predicted_service_runtime_seconds=30, predictor_version="pilot-static-v1", queued_at=now)
    capacity = WorkerCapacitySnapshot("research-read-v1", 1, now)
    candidate = SchedulerCandidate(attempt.attempt_id, task.task_id, 1, task.workspace_id, "research-read-v1", task.priority, 30, "pilot-static-v1", SchedulerQueueKind.READY, now, now)
    rank = SchedulerRank(attempt.attempt_id, 1, 1, 30, ShadowSchedulingLane.PREDICTED_SJF)
    claim = ClaimedSchedulerEntry(candidate, uuid4(), "dispatcher-1", now + timedelta(seconds=60), rank)
    return task, attempt, capacity, claim


async def test_dispatcher_allows_only_research_profile_and_acks_after_sink_acceptance() -> None:
    task, attempt, capacity, claim = fixture()
    store = RecordingStore(claim)
    sink = RecordingSink(True)
    dispatcher = ResearchFifoDispatcherPilot(store, sink, resource_pool="research-read-v1", claimed_by="dispatcher-1")  # type: ignore[arg-type]

    await dispatcher.observe_queued(task, attempt, capacity)
    selected = await dispatcher.dispatch_once(now=capacity.captured_at)

    assert selected == claim
    assert store.candidates[0].attempt_id == attempt.attempt_id
    assert sink.claims == [claim]
    assert store.acknowledged == [(attempt.attempt_id, claim.claim_id, "dispatcher-1")]


async def test_dispatcher_leaves_claim_leased_when_sink_does_not_accept() -> None:
    _, _, capacity, claim = fixture()
    store = RecordingStore(claim)
    dispatcher = ResearchFifoDispatcherPilot(store, RecordingSink(False), resource_pool="research-read-v1", claimed_by="dispatcher-1")  # type: ignore[arg-type]

    assert await dispatcher.dispatch_once(now=capacity.captured_at) == claim
    assert store.acknowledged == []


async def test_dispatcher_surfaces_ack_loss_after_sink_acceptance() -> None:
    _, _, capacity, claim = fixture()
    dispatcher = ResearchFifoDispatcherPilot(FailingAckStore(claim), RecordingSink(True), resource_pool="research-read-v1", claimed_by="dispatcher-1")  # type: ignore[arg-type]

    with pytest.raises(RuntimeError, match="ACK loss"):
        await dispatcher.dispatch_once(now=capacity.captured_at)


async def test_dispatcher_rejects_unapproved_profile() -> None:
    task, attempt, capacity, _ = fixture()
    task = task.model_copy(update={"execution": task.execution.model_copy(update={"specialist_profile": "general-purpose-v1"})})
    dispatcher = ResearchFifoDispatcherPilot(RecordingStore(), RecordingSink(True), resource_pool="research-read-v1", claimed_by="dispatcher-1")  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="profile"):
        await dispatcher.observe_queued(task, attempt, capacity)
