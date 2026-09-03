from __future__ import annotations

import asyncio

# ruff: noqa: E501, I001

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from contracts import DepartmentName, ModelSelection, Provider, RunBudget
from runtime import AttemptStatus, ClaimedSchedulerEntry, DepartmentTask, ExecutionRoute, PostgresResearchResultFence, ResearchDispatchContext, ResearchWorkerDispatchSink, SchedulerCandidate, SchedulerQueueKind, SchedulerRank, ShadowSchedulingLane, TaskAttempt, TaskExecutionSnapshot, TaskStatus


def fixture() -> tuple[ResearchDispatchContext, ClaimedSchedulerEntry]:
    now = datetime.now(UTC)
    budget = RunBudget(max_duration_seconds=60, max_model_calls=2, max_tool_calls=2, max_input_tokens=1000, max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1)
    execution = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=["agent.run", "project.read"], budget=budget, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", specialist_profile="research-read-v1", authorization_revision=3, budget_revision=2)
    task = DepartmentTask(task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), project_id=uuid4(), department=DepartmentName.RESEARCH, revision=1, status=TaskStatus.QUEUED, execution=execution, created_at=now)
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=1, attempt_number=1, status=AttemptStatus.QUEUED, predicted_service_runtime_seconds=30, predictor_version="pilot-static-v1", queued_at=now)
    candidate = SchedulerCandidate(attempt.attempt_id, task.task_id, 1, task.workspace_id, "research-read-v1", task.priority, 30, "pilot-static-v1", SchedulerQueueKind.READY, now, now)
    rank = SchedulerRank(attempt.attempt_id, 1, 1, 30, ShadowSchedulingLane.PREDICTED_SJF)
    claim = ClaimedSchedulerEntry(candidate, uuid4(), "dispatcher-1", now + timedelta(seconds=60), rank)
    context = ResearchDispatchContext(task, attempt, "Check the official policy", "KR", {"agent.run", "project.read"}, 3, 2, budget, "workload-token")
    return context, claim


class FixedLoader:
    def __init__(self, context: ResearchDispatchContext | None) -> None:
        self.context = context

    async def load(self, claim: ClaimedSchedulerEntry) -> ResearchDispatchContext | None:
        del claim
        return self.context

    async def discard(self, attempt_id: object) -> None:
        del attempt_id
        self.context = None


class RecordingWorker:
    def __init__(self) -> None:
        self.calls: list[tuple[DepartmentTask, TaskAttempt, str]] = []

    def validate(self, task: DepartmentTask, attempt: TaskAttempt, **values: object) -> None:
        del task, attempt, values

    async def run(self, task: DepartmentTask, attempt: TaskAttempt, **values: object) -> None:
        self.calls.append((task, attempt, str(values["objective"])))


class RejectingWorker(RecordingWorker):
    def validate(self, task: DepartmentTask, attempt: TaskAttempt, **values: object) -> None:
        del task, attempt, values
        raise RuntimeError("TaskGuard rejected the dispatch")


class CurrentStateRegistry:
    def __init__(self, task: DepartmentTask, attempt: TaskAttempt) -> None:
        self.task = task
        self.attempt = attempt

    async def get_task(self, task_id: object, revision: int, workspace_id: object) -> DepartmentTask:
        del task_id, revision, workspace_id
        return self.task

    async def get_attempt(self, attempt_id: object, workspace_id: object) -> TaskAttempt:
        del attempt_id, workspace_id
        return self.attempt


async def test_dispatch_sink_starts_worker_only_for_exact_current_claim() -> None:
    context, claim = fixture()
    worker = RecordingWorker()
    sink = ResearchWorkerDispatchSink(worker, FixedLoader(context))  # type: ignore[arg-type]

    assert await sink.dispatch(claim)
    await sink.wait()

    assert worker.calls == [(context.task, context.attempt, context.objective)]


async def test_dispatch_sink_publishes_only_the_worker_workload() -> None:
    context, claim = fixture()
    observed: list[tuple[str, UUID, UUID]] = []

    class Publisher:
        async def publish_once(self, workload_token: str, *, workspace_id: UUID, run_id: UUID, batch_size: int = 100) -> int:
            observed.append((workload_token, workspace_id, run_id))
            return 1

    sink = ResearchWorkerDispatchSink(RecordingWorker(), FixedLoader(context), Publisher())  # type: ignore[arg-type]
    assert await sink.dispatch(claim)
    await sink.wait()
    assert observed == [(context.workload_token, context.task.workspace_id, context.task.run_id)]


async def test_dispatch_sink_rejects_claim_with_different_attempt() -> None:
    context, claim = fixture()
    worker = RecordingWorker()
    different = claim.candidate.__class__(uuid4(), claim.candidate.task_id, claim.candidate.task_revision, claim.candidate.workspace_id, claim.candidate.resource_pool, claim.candidate.priority, claim.candidate.predicted_runtime_seconds, claim.candidate.predictor_version, claim.candidate.queue_kind, claim.candidate.enqueued_at, claim.candidate.available_at)
    claim = claim.__class__(different, claim.claim_id, claim.claimed_by, claim.lease_until, claim.rank)
    sink = ResearchWorkerDispatchSink(worker, FixedLoader(context))  # type: ignore[arg-type]

    assert not await sink.dispatch(claim)
    assert worker.calls == []


async def test_dispatch_sink_rejects_before_worker_scheduling_when_guard_fails() -> None:
    context, claim = fixture()
    worker = RejectingWorker()
    sink = ResearchWorkerDispatchSink(worker, FixedLoader(context))  # type: ignore[arg-type]

    assert not await sink.dispatch(claim)
    await sink.wait()

    assert worker.calls == []


def test_dispatch_context_repr_hides_workload_token() -> None:
    context, _ = fixture()

    assert context.workload_token not in repr(context)


@pytest.mark.parametrize("task_status,attempt_status", [(TaskStatus.CANCELLED, AttemptStatus.CANCELLED), (TaskStatus.SUPERSEDED, AttemptStatus.SUPERSEDED)])
async def test_postgres_result_fence_rejects_cancelled_or_redirected_current_state(task_status: TaskStatus, attempt_status: AttemptStatus) -> None:
    context, _ = fixture()
    current_task = context.task.model_copy(update={"status": task_status})
    current_attempt = context.attempt.model_copy(update={"status": attempt_status})
    fence = PostgresResearchResultFence(CurrentStateRegistry(current_task, current_attempt))  # type: ignore[arg-type]

    assert not await fence.allows(context.task, context.attempt)


class BlockingWorker(RecordingWorker):
    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.cancelled = False

    async def run(self, task: DepartmentTask, attempt: TaskAttempt, **values: object) -> None:
        await super().run(task, attempt, **values)
        self.started.set()
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise


async def test_worker_capacity_is_reserved_before_loader_await() -> None:
    context, claim = fixture()
    entered = asyncio.Event()
    release = asyncio.Event()

    class SlowLoader(FixedLoader):
        async def load(self, claim: ClaimedSchedulerEntry) -> ResearchDispatchContext | None:
            entered.set()
            await release.wait()
            return await super().load(claim)

    worker = BlockingWorker()
    sink = ResearchWorkerDispatchSink(worker, SlowLoader(context), worker_count=1)  # type: ignore[arg-type]
    first = asyncio.create_task(sink.dispatch(claim))
    await entered.wait()
    assert not sink.has_capacity
    assert not await sink.dispatch(claim)
    release.set()
    assert await first
    await worker.started.wait()
    assert len(worker.calls) == 1
    worker.release.set()
    await sink.wait()
    assert sink.has_capacity


async def test_ack_failure_does_not_start_worker_and_releases_slot() -> None:
    context, claim = fixture()
    worker = RecordingWorker()
    sink = ResearchWorkerDispatchSink(worker, FixedLoader(context))  # type: ignore[arg-type]

    async def fail_ack() -> None:
        raise RuntimeError("ACK unavailable")

    with pytest.raises(RuntimeError, match="ACK unavailable"):
        await sink.dispatch(claim, acknowledge=fail_ack)
    await sink.wait()
    assert worker.calls == []
    assert sink.has_capacity


async def test_worker_starts_only_after_ack_and_close_cancels_bounded_work() -> None:
    context, claim = fixture()
    worker = BlockingWorker()
    sink = ResearchWorkerDispatchSink(worker, FixedLoader(context), shutdown_timeout_seconds=0.01)  # type: ignore[arg-type]

    async def acknowledge() -> None:
        assert worker.calls == []

    assert await sink.dispatch(claim, acknowledge=acknowledge)
    await worker.started.wait()
    await asyncio.wait_for(sink.close(), timeout=2)
    assert worker.cancelled
    assert not await sink.dispatch(claim)


async def test_dispatch_loop_polls_without_new_registration_and_stops_on_close() -> None:
    reached = asyncio.Event()
    calls = 0

    async def dispatch_once() -> None:
        nonlocal calls
        calls += 1
        if calls >= 2:
            reached.set()

    sink = ResearchWorkerDispatchSink(RecordingWorker(), FixedLoader(None))  # type: ignore[arg-type]
    sink.bind_dispatcher(dispatch_once)
    sink.start()
    sink.start()
    await asyncio.wait_for(reached.wait(), timeout=2)
    await sink.close()
    assert sink._dispatcher_task is not None and sink._dispatcher_task.done()
