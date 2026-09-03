"""White-box ownership checks; real transaction/race coverage lives in integration tests."""

# ruff: noqa: E501, I001

from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

from infrastructure.database.models import AgentResearchBudgetModel, AgentRunStateModel, AgentTaskModel, AgentTaskAttemptModel, AgentSchedulerEntryModel
from runtime.research_ownership import PostgresResearchOwnership
from runtime.task_attempt_events import TaskAttemptEventWrite
from runtime.task_scheduler_store import SchedulerClaimConflictError


class Session:
    def __init__(self, rows):
        self.rows = rows
        self.events = []
        self.fail_event = False

    async def get(self, model, key, **options):
        return self.rows.get(model)

    async def execute(self, statement, params=None):
        pass

    async def scalar(self, statement):
        return len(self.events)

    async def scalars(self, statement):
        self.recovery_sql = str(statement)
        return SimpleNamespace(all=lambda: [self.rows[AgentSchedulerEntryModel]])

    async def refresh(self, row, **options):
        pass

    def add(self, event):
        if self.fail_event:
            raise RuntimeError("event persistence failed")
        self.events.append(event)


class Database:
    def __init__(self, session):
        self.value = session

    @asynccontextmanager
    async def session(self):
        previous = {kind: deepcopy(row.__dict__) for kind, row in self.value.rows.items()}
        event_count = len(self.value.events)
        try:
            yield self.value
        except BaseException:
            for kind, state in previous.items():
                self.value.rows[kind].__dict__.clear()
                self.value.rows[kind].__dict__.update(state)
            del self.value.events[event_count:]
            raise


@pytest.fixture
def state():
    now = datetime.now(UTC)
    run_id, task_id, attempt_id, workspace_id, claim_id = (uuid4() for _ in range(5))
    budget = {"max_duration_seconds": 2}
    snapshot = {"budget": budget}
    task = SimpleNamespace(task_id=task_id, run_id=run_id, workspace_id=workspace_id, revision=1, status="QUEUED", execution_json=snapshot)
    attempt = SimpleNamespace(attempt_id=attempt_id, task_id=task_id, task_revision=1, run_id=run_id, workspace_id=workspace_id, attempt_number=1, status="QUEUED", started_at=None)
    entry = SimpleNamespace(attempt_id=attempt_id, task_id=task_id, task_revision=1, resource_pool="test-pool", workspace_id=workspace_id, entry_status="DISPATCHED", claim_id=claim_id, claimed_by="worker-a", lease_until=now + timedelta(seconds=60))
    reservation = SimpleNamespace(workspace_id=workspace_id, shadow_status="RESERVED", shadow_json=budget)
    session = Session({AgentTaskModel: task, AgentTaskAttemptModel: attempt, AgentSchedulerEntryModel: entry, AgentRunStateModel: SimpleNamespace(status="RUNNING"), AgentResearchBudgetModel: reservation})
    ownership = PostgresResearchOwnership(Database(session))
    claim = SimpleNamespace(candidate=SimpleNamespace(task_id=task_id, task_revision=1, attempt_id=attempt_id, workspace_id=workspace_id, resource_pool="test-pool"), claim_id=claim_id, claimed_by="worker-a")
    value = SimpleNamespace(task_id=task_id, run_id=run_id, workspace_id=workspace_id, execution=SimpleNamespace(model_dump=lambda **kw: snapshot, budget=SimpleNamespace(max_duration_seconds=2, model_dump=lambda **kw: budget)))

    def event(event_type="attempt.started", data=None):
        return TaskAttemptEventWrite(event_id="test", source="research-read-worker-v1", source_event_id="test", run_id=run_id, workspace_id=workspace_id, task_id=task_id, task_revision=1, attempt_id=attempt_id, attempt_number=1, sequence=1, event_type=event_type, occurred_at=datetime.now(UTC), data=data or {})

    return SimpleNamespace(**locals())


async def test_start_and_finish_commit_both_states_with_events_and_budget(state):
    s = state
    await s.ownership.begin(s.value, s.attempt, s.claim, s.event())
    assert s.task.status == s.attempt.status == "RUNNING"
    assert s.reservation.shadow_status == "RUNNING"
    assert s.entry.claim_id == s.claim_id
    await s.ownership.finish(s.value, s.attempt, s.claim, s.event("attempt.completed", {"result": {"model_calls": 2, "search_credits": 1}}))
    assert s.task.status == s.attempt.status == "COMPLETED"
    assert s.entry.entry_status == "FINISHED" and s.entry.claim_id is None
    assert s.reservation.shadow_usage_json == {"model_calls": 2, "search_credits": 1}
    assert [e.sequence for e in s.session.events] == [1, 2]


async def test_event_failure_does_not_leave_half_started_states(state):
    s = state
    s.session.fail_event = True
    with pytest.raises(RuntimeError, match="event persistence"):
        await s.ownership.begin(s.value, s.attempt, s.claim, s.event())
    assert s.task.status == s.attempt.status == "QUEUED"
    assert s.reservation.shadow_status == "RESERVED"
    assert not s.session.events


@pytest.mark.parametrize("field,value", [("entry_status", "PENDING"), ("claim_id", None), ("claimed_by", "worker-b"), ("lease_until", datetime(2000, 1, 1, tzinfo=UTC))])
async def test_stale_owner_cannot_start(state, field, value):
    s = state
    setattr(s.entry, field, value)
    with pytest.raises(SchedulerClaimConflictError):
        await s.ownership.begin(s.value, s.attempt, s.claim, s.event())
    assert not s.session.events


async def test_missing_budget_denies_external_start(state):
    s = state
    s.reservation.shadow_json = None
    with pytest.raises(SchedulerClaimConflictError, match="budget"):
        await s.ownership.begin(s.value, s.attempt, s.claim, s.event())


async def test_expired_ack_before_start_is_requeued_without_a_fake_execution_event(state):
    s = state
    s.entry.lease_until = datetime.now(UTC) - timedelta(seconds=1)
    assert await s.ownership.recover_expired("test-pool", [s.workspace_id]) == 1
    assert s.entry.entry_status == "PENDING"
    assert s.task.status == s.attempt.status == "QUEUED"
    assert not s.session.events


async def test_lost_running_worker_fails_once_and_late_result_is_fenced(state):
    s = state
    await s.ownership.begin(s.value, s.attempt, s.claim, s.event())
    s.entry.lease_until = datetime.now(UTC) - timedelta(seconds=1)
    assert await s.ownership.recover_expired("test-pool", [s.workspace_id]) == 1
    assert s.task.status == s.attempt.status == "FAILED"
    assert s.reservation.shadow_status == "UNKNOWN"
    assert s.session.events[-1].data_json["failure_code"] == "WORKER_LOST"
    assert await s.ownership.recover_expired("test-pool", [s.workspace_id]) == 0
    with pytest.raises(SchedulerClaimConflictError):
        await s.ownership.finish(s.value, s.attempt, s.claim, s.event("attempt.completed"))
    assert len(s.session.events) == 2


async def test_cancel_or_redirect_wins_over_late_result(state):
    s = state
    await s.ownership.begin(s.value, s.attempt, s.claim, s.event())
    s.task.status = s.attempt.status = "CANCELLED"
    with pytest.raises(SchedulerClaimConflictError):
        await s.ownership.finish(s.value, s.attempt, s.claim, s.event("attempt.completed"))
    s.entry.lease_until = datetime.now(UTC) - timedelta(seconds=1)
    await s.ownership.recover_expired("test-pool", [s.workspace_id])
    assert s.task.status == s.attempt.status == "CANCELLED"
    assert s.reservation.shadow_status == "UNKNOWN"


async def test_parent_cancelled_during_execution_cannot_publish_success(state):
    s = state
    await s.ownership.begin(s.value, s.attempt, s.claim, s.event())
    s.session.rows[AgentRunStateModel].status = "CANCELLED"
    await s.ownership.finish(s.value, s.attempt, s.claim, s.event("attempt.completed"))
    assert s.task.status == s.attempt.status == "FAILED"
    assert s.session.events[-1].data_json["failure_code"] == "PARENT_RUN_TERMINATED"
