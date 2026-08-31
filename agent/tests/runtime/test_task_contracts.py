# ruff: noqa: E501, I001

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from contracts import DepartmentName, ModelSelection, Provider, ReasoningEffort, RunBudget
from runtime.task_contracts import (
    AttemptStatus,
    DepartmentTask,
    ExecutionRoute,
    TaskAttempt,
    TaskCommand,
    TaskCommandType,
    TaskEvent,
    TaskExecutionSnapshot,
    TaskRevisionConflictError,
    TaskScopeError,
    TaskStatus,
    TaskTransitionError,
    ensure_attempt_transition,
    ensure_expected_revision,
    ensure_next_revision,
    ensure_task_transition,
    ensure_workspace_scope
)


def make_budget() -> RunBudget:
    return RunBudget(max_duration_seconds=300, max_model_calls=5, max_tool_calls=10, max_input_tokens=10000, max_output_tokens=5000, max_departments=2, max_hierarchy_depth=2)


def make_snapshot() -> TaskExecutionSnapshot:
    return TaskExecutionSnapshot(route=ExecutionRoute.SUPERVISOR, permissions=["project.read", "knowledge.read"], budget=make_budget(), model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test", reasoning_effort=ReasoningEffort.LOW), policy_version="routing-v1", prompt_version="research-v1", tool_schema_version="spring-tool-v1")


def make_task(**overrides: object) -> DepartmentTask:
    values: dict[str, object] = {"task_id": uuid4(), "run_id": uuid4(), "workspace_id": uuid4(), "project_id": uuid4(), "department": DepartmentName.RESEARCH, "revision": 1, "execution": make_snapshot(), "created_at": datetime.now(UTC)}
    values.update(overrides)
    return DepartmentTask.model_validate(values)


def test_department_task_accepts_immutable_versioned_snapshot() -> None:
    task = make_task()

    assert task.status is TaskStatus.SUBMITTED
    assert task.execution.route is ExecutionRoute.SUPERVISOR
    with pytest.raises(ValidationError, match="frozen"):
        task.priority = 5


def test_department_task_rejects_self_and_duplicate_dependencies() -> None:
    task_id = uuid4()
    dependency_id = uuid4()

    with pytest.raises(ValidationError, match="depend on itself"):
        make_task(task_id=task_id, dependency_task_ids=[task_id])
    with pytest.raises(ValidationError, match="unique"):
        make_task(task_id=task_id, dependency_task_ids=[dependency_id, dependency_id])


def test_execution_snapshot_rejects_duplicate_permissions() -> None:
    with pytest.raises(ValidationError, match="unique"):
        TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=["project.read", "project.read"], budget=make_budget(), model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), policy_version="routing-v1", prompt_version="react-v1", tool_schema_version="spring-tool-v1")


def test_task_attempt_requires_prediction_version_and_monotonic_timestamps() -> None:
    now = datetime.now(UTC)

    with pytest.raises(ValidationError, match="recorded together"):
        TaskAttempt(attempt_id=uuid4(), task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), task_revision=1, attempt_number=1, predicted_service_runtime_seconds=12.0)
    with pytest.raises(ValidationError, match="monotonic"):
        TaskAttempt(attempt_id=uuid4(), task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), task_revision=1, attempt_number=1, queued_at=now, started_at=now - timedelta(seconds=1))


@pytest.mark.parametrize("payload", [{"secret": "value"}, {"nested": {"delegation_token": "value"}}, {"items": [{"chain_of_thought": "value"}]}])
def test_command_and_event_reject_forbidden_runtime_data(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError, match="forbidden"):
        TaskCommand(command_id=uuid4(), task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), expected_revision=1, type=TaskCommandType.SOFT_UPDATE, idempotency_key="command-1", requested_by=uuid4(), requested_at=datetime.now(UTC), payload=payload)
    with pytest.raises(ValidationError, match="forbidden"):
        TaskEvent(event_id="event-1", source="worker", source_event_id="source-1", task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), task_revision=1, sequence=1, type="task.updated", occurred_at=datetime.now(UTC), data=payload)


def test_contracts_reject_naive_timestamps() -> None:
    with pytest.raises(ValidationError, match="timezone-aware"):
        make_task(created_at=datetime.now())


@pytest.mark.parametrize("current,target", [(TaskStatus.SUBMITTED, TaskStatus.ADMITTED), (TaskStatus.RUNNING, TaskStatus.CHECKPOINTED), (TaskStatus.RETRY_WAIT, TaskStatus.DEFERRED), (TaskStatus.PAUSED, TaskStatus.ADMITTED)])
def test_task_transitions_allow_expected_runtime_flow(current: TaskStatus, target: TaskStatus) -> None:
    ensure_task_transition(current, target)


@pytest.mark.parametrize("current,target", [(TaskStatus.COMPLETED, TaskStatus.RUNNING), (TaskStatus.CANCELLED, TaskStatus.ADMITTED), (TaskStatus.SUBMITTED, TaskStatus.RUNNING), (TaskStatus.RETRY_WAIT, TaskStatus.QUEUED)])
def test_task_transitions_reject_bypass_and_terminal_changes(current: TaskStatus, target: TaskStatus) -> None:
    with pytest.raises(TaskTransitionError):
        ensure_task_transition(current, target)


def test_attempt_transitions_require_queue_and_reject_terminal_changes() -> None:
    ensure_attempt_transition(AttemptStatus.PREDICTED, AttemptStatus.QUEUED)
    ensure_attempt_transition(AttemptStatus.QUEUED, AttemptStatus.RUNNING)

    with pytest.raises(TaskTransitionError):
        ensure_attempt_transition(AttemptStatus.PREDICTED, AttemptStatus.RUNNING)
    with pytest.raises(TaskTransitionError):
        ensure_attempt_transition(AttemptStatus.COMPLETED, AttemptStatus.RUNNING)


def test_revision_guards_reject_stale_and_skipped_revisions() -> None:
    ensure_expected_revision(3, 3)
    ensure_next_revision(3, 4)

    with pytest.raises(TaskRevisionConflictError):
        ensure_expected_revision(3, 2)
    with pytest.raises(TaskRevisionConflictError):
        ensure_next_revision(3, 5)


def test_workspace_guard_uses_trusted_scope() -> None:
    workspace_id = uuid4()
    ensure_workspace_scope(workspace_id, workspace_id)

    with pytest.raises(TaskScopeError):
        ensure_workspace_scope(workspace_id, UUID("00000000-0000-0000-0000-000000000001"))
