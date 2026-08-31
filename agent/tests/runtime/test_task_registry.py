# ruff: noqa: E501, I001

from datetime import UTC, datetime
from uuid import uuid4

from contracts import DepartmentName, ModelSelection, Provider, RunBudget
from runtime import AttemptStatus, DepartmentTask, ExecutionRoute, PostgresTaskRegistry, TaskAttempt, TaskExecutionSnapshot, TaskStatus


def snapshot() -> TaskExecutionSnapshot:
    return TaskExecutionSnapshot(route=ExecutionRoute.SUPERVISOR, permissions=["project.read"], budget=RunBudget(max_duration_seconds=60, max_model_calls=2, max_tool_calls=2, max_input_tokens=1000, max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1), model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), policy_version="routing-v1", prompt_version="research-v1", tool_schema_version="spring-tool-v1")


def test_task_model_round_trip_preserves_versioned_contract() -> None:
    task = DepartmentTask(task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), project_id=uuid4(), department=DepartmentName.RESEARCH, revision=2, status=TaskStatus.DEFERRED, dependency_task_ids=[uuid4()], execution=snapshot(), created_at=datetime.now(UTC))

    model = PostgresTaskRegistry._task_model(task)
    restored = PostgresTaskRegistry._task(model)

    assert restored == task


def test_attempt_model_round_trip_preserves_prediction_and_status() -> None:
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), task_revision=2, attempt_number=3, status=AttemptStatus.QUEUED, predicted_service_runtime_seconds=12.5, predictor_version="predictor-v2", queued_at=datetime.now(UTC))

    model = PostgresTaskRegistry._attempt_model(attempt)
    restored = PostgresTaskRegistry._attempt(model)

    assert restored == attempt
