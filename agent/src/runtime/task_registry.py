"""PostgreSQL registry for versioned tasks and execution attempts."""

# ruff: noqa: E501, I001

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentTaskAttemptModel, AgentTaskModel

from .task_contracts import (
    AttemptStatus,
    DepartmentTask,
    TaskAttempt,
    TaskRevisionConflictError,
    TaskStatus,
    ensure_attempt_transition,
    ensure_expected_revision,
    ensure_next_revision,
    ensure_task_transition,
    ensure_workspace_scope
)


class TaskRegistryError(RuntimeError):
    pass


class TaskNotFoundError(TaskRegistryError):
    pass


class TaskAlreadyExistsError(TaskRegistryError):
    pass


class AttemptNotFoundError(TaskRegistryError):
    pass


class AttemptAlreadyExistsError(TaskRegistryError):
    pass


class PostgresTaskRegistry:
    def __init__(self, database: PgVectorConnectionManager) -> None:
        self._database = database

    async def initialize(self) -> None:
        await self._database.verify_runtime_tables()

    async def create_task(self, task: DepartmentTask) -> DepartmentTask:
        model = self._task_model(task)
        try:
            async with self._database.session() as session:
                session.add(model)
                await session.flush()
        except IntegrityError as error:
            try:
                existing = await self.get_task(task.task_id, task.revision, task.workspace_id)
            except (TaskNotFoundError, TaskRevisionConflictError):
                raise TaskRegistryError("task could not be created because a registry constraint was violated") from error
            if existing == task:
                return existing
            raise TaskAlreadyExistsError("task id and revision already exist with different data") from error
        return self._task(model)

    async def get_task(self, task_id: UUID, revision: int, workspace_id: UUID) -> DepartmentTask:
        async with self._database.session() as session:
            model = await session.get(AgentTaskModel, (task_id, revision))
        if model is None:
            await self._raise_task_lookup_error(task_id, revision)
        assert model is not None
        ensure_workspace_scope(workspace_id, model.workspace_id)
        return self._task(model)

    async def transition_task(self, task_id: UUID, revision: int, workspace_id: UUID, target: TaskStatus) -> DepartmentTask:
        async with self._database.session() as session:
            model = await self._locked_task(session, task_id, revision)
            ensure_workspace_scope(workspace_id, model.workspace_id)
            ensure_task_transition(TaskStatus(model.status), target)
            model.status = target.value
            model.updated_at = datetime.now(UTC)
            await session.flush()
            return self._task(model)

    async def create_next_revision(self, current_revision: int, task: DepartmentTask) -> DepartmentTask:
        ensure_next_revision(current_revision, task.revision)
        if task.status is not TaskStatus.SUBMITTED:
            raise TaskRevisionConflictError("new task revision must start in SUBMITTED")
        async with self._database.session() as session:
            current = await self._locked_task(session, task.task_id, current_revision)
            ensure_workspace_scope(task.workspace_id, current.workspace_id)
            if task.run_id != current.run_id or task.project_id != current.project_id or task.department.value != current.department:
                raise TaskRevisionConflictError("new task revision cannot change run, project or department identity")
            ensure_task_transition(TaskStatus(current.status), TaskStatus.SUPERSEDED)
            current.status = TaskStatus.SUPERSEDED.value
            current.updated_at = datetime.now(UTC)
            replacement = self._task_model(task)
            session.add(replacement)
            try:
                await session.flush()
            except IntegrityError as error:
                raise TaskAlreadyExistsError("next task revision already exists") from error
            return self._task(replacement)

    async def create_attempt(self, attempt: TaskAttempt) -> TaskAttempt:
        model = self._attempt_model(attempt)
        try:
            async with self._database.session() as session:
                task = await self._locked_task(session, attempt.task_id, attempt.task_revision)
                ensure_workspace_scope(attempt.workspace_id, task.workspace_id)
                if attempt.run_id != task.run_id:
                    raise TaskRevisionConflictError("attempt run does not match its task")
                session.add(model)
                await session.flush()
        except IntegrityError as error:
            try:
                existing = await self.get_attempt(attempt.attempt_id, attempt.workspace_id)
            except AttemptNotFoundError:
                raise AttemptAlreadyExistsError("attempt identity or task attempt number already exists") from error
            if existing == attempt:
                return existing
            raise AttemptAlreadyExistsError("attempt identity already exists with different data") from error
        return self._attempt(model)

    async def get_attempt(self, attempt_id: UUID, workspace_id: UUID) -> TaskAttempt:
        async with self._database.session() as session:
            model = await session.get(AgentTaskAttemptModel, attempt_id)
        if model is None:
            raise AttemptNotFoundError("task attempt was not found")
        ensure_workspace_scope(workspace_id, model.workspace_id)
        return self._attempt(model)

    async def transition_attempt(self, attempt_id: UUID, workspace_id: UUID, target: AttemptStatus, *, queued_at: datetime | None = None, started_at: datetime | None = None, finished_at: datetime | None = None) -> TaskAttempt:
        async with self._database.session() as session:
            statement = select(AgentTaskAttemptModel).where(AgentTaskAttemptModel.attempt_id == attempt_id).with_for_update()
            model = await session.scalar(statement)
            if model is None:
                raise AttemptNotFoundError("task attempt was not found")
            ensure_workspace_scope(workspace_id, model.workspace_id)
            ensure_attempt_transition(AttemptStatus(model.status), target)
            model.status = target.value
            model.queued_at = queued_at if queued_at is not None else model.queued_at
            model.started_at = started_at if started_at is not None else model.started_at
            model.finished_at = finished_at if finished_at is not None else model.finished_at
            model.updated_at = datetime.now(UTC)
            attempt = self._attempt(model)
            await session.flush()
            return attempt

    async def _locked_task(self, session: AsyncSession, task_id: UUID, revision: int) -> AgentTaskModel:
        statement = select(AgentTaskModel).where(AgentTaskModel.task_id == task_id, AgentTaskModel.revision == revision).with_for_update()
        model = await session.scalar(statement)
        if model is not None:
            return model
        latest = await session.scalar(select(func.max(AgentTaskModel.revision)).where(AgentTaskModel.task_id == task_id))
        if latest is not None:
            ensure_expected_revision(int(latest), revision)
        raise TaskNotFoundError("task was not found")

    async def _raise_task_lookup_error(self, task_id: UUID, revision: int) -> None:
        async with self._database.session() as session:
            latest = await session.scalar(select(func.max(AgentTaskModel.revision)).where(AgentTaskModel.task_id == task_id))
        if latest is not None:
            ensure_expected_revision(int(latest), revision)
        raise TaskNotFoundError("task was not found")

    @staticmethod
    def _task_model(task: DepartmentTask) -> AgentTaskModel:
        now = datetime.now(UTC)
        return AgentTaskModel(task_id=task.task_id, revision=task.revision, run_id=task.run_id, workspace_id=task.workspace_id, project_id=task.project_id, department=task.department.value, status=task.status.value, priority=task.priority, dependency_task_ids=[str(value) for value in task.dependency_task_ids], execution_json=task.execution.model_dump(mode="json"), schema_version=task.schema_version, created_at=task.created_at, updated_at=now)

    @staticmethod
    def _task(model: AgentTaskModel) -> DepartmentTask:
        return DepartmentTask.model_validate({"task_id": model.task_id, "run_id": model.run_id, "workspace_id": model.workspace_id, "project_id": model.project_id, "department": model.department, "revision": model.revision, "status": model.status, "priority": model.priority, "dependency_task_ids": model.dependency_task_ids, "execution": model.execution_json, "created_at": model.created_at, "schema_version": model.schema_version})

    @staticmethod
    def _attempt_model(attempt: TaskAttempt) -> AgentTaskAttemptModel:
        now = datetime.now(UTC)
        return AgentTaskAttemptModel(attempt_id=attempt.attempt_id, task_id=attempt.task_id, task_revision=attempt.task_revision, run_id=attempt.run_id, workspace_id=attempt.workspace_id, attempt_number=attempt.attempt_number, status=attempt.status.value, predicted_service_runtime_seconds=attempt.predicted_service_runtime_seconds, predictor_version=attempt.predictor_version, queued_at=attempt.queued_at, started_at=attempt.started_at, finished_at=attempt.finished_at, schema_version=attempt.schema_version, created_at=now, updated_at=now)

    @staticmethod
    def _attempt(model: AgentTaskAttemptModel) -> TaskAttempt:
        return TaskAttempt(attempt_id=model.attempt_id, task_id=model.task_id, run_id=model.run_id, workspace_id=model.workspace_id, task_revision=model.task_revision, attempt_number=model.attempt_number, status=AttemptStatus(model.status), predicted_service_runtime_seconds=model.predicted_service_runtime_seconds, predictor_version=model.predictor_version, queued_at=model.queued_at, started_at=model.started_at, finished_at=model.finished_at, schema_version=model.schema_version)
