"""Durable TaskAttempt lifecycle adapter for the read-only Research specialist."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Collection
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from contracts import RunBudget

from .research_specialist import ResearchSpecialistError, ResearchSpecialistResult
from .task_attempt_events import TaskAttemptEventWrite
from .task_contracts import AttemptStatus, DepartmentTask, TaskAttempt, TaskStatus
from .task_guard import TaskGuard


class ResearchExecution(Protocol):
    async def execute(self, task: DepartmentTask, *, objective: str, jurisdiction: str | None = None) -> ResearchSpecialistResult: ...


class ResearchTaskRegistry(Protocol):
    async def transition_task(self, task_id: UUID, revision: int, workspace_id: UUID, target: TaskStatus) -> DepartmentTask: ...

    async def transition_attempt(self, attempt_id: UUID, workspace_id: UUID, target: AttemptStatus, *, queued_at: datetime | None = None, started_at: datetime | None = None, finished_at: datetime | None = None, event: TaskAttemptEventWrite | None = None) -> TaskAttempt: ...


class ResearchTaskWorker:
    SOURCE = "research-read-worker-v1"

    def __init__(self, registry: ResearchTaskRegistry, specialist: ResearchExecution, guard: TaskGuard | None = None) -> None:
        self._registry = registry
        self._specialist = specialist
        self._guard = guard or TaskGuard()

    async def run(self, task: DepartmentTask, attempt: TaskAttempt, *, objective: str, jurisdiction: str | None, current_permissions: Collection[str], current_authorization_revision: int, current_budget_revision: int, parent_budget: RunBudget) -> ResearchSpecialistResult:
        self._require_identity(task, attempt)
        self._guard.validate(task, current_permissions=current_permissions, current_authorization_revision=current_authorization_revision, current_budget_revision=current_budget_revision, parent_budget=parent_budget)
        started_at = datetime.now(UTC)
        started_event = self._event(task, attempt, 1, "attempt.started", started_at, phase="RESEARCH", milestone="Research specialist started")
        await self._registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.RUNNING, started_at=started_at, event=started_event)
        await self._registry.transition_task(task.task_id, task.revision, task.workspace_id, TaskStatus.RUNNING)
        try:
            result = await self._specialist.execute(task, objective=objective, jurisdiction=jurisdiction)
        except Exception as error:
            code = error.code if isinstance(error, ResearchSpecialistError) else "RESEARCH_WORKER_FAILED"
            failed_at = datetime.now(UTC)
            failed_event = self._event(task, attempt, 2, "attempt.failed", failed_at, phase="VERIFICATION", milestone="Research specialist failed", data={"failure_code": code})
            await self._registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.FAILED, finished_at=failed_at, event=failed_event)
            await self._registry.transition_task(task.task_id, task.revision, task.workspace_id, TaskStatus.FAILED)
            if isinstance(error, ResearchSpecialistError):
                raise
            raise ResearchSpecialistError(code) from error

        completed_at = datetime.now(UTC)
        completed_event = self._event(task, attempt, 2, "attempt.completed", completed_at, phase="VERIFICATION", milestone="Evidence verification passed", data={"result": result.model_dump(mode="json")})
        await self._registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.COMPLETED, finished_at=completed_at, event=completed_event)
        await self._registry.transition_task(task.task_id, task.revision, task.workspace_id, TaskStatus.COMPLETED)
        return result

    @staticmethod
    def _require_identity(task: DepartmentTask, attempt: TaskAttempt) -> None:
        invalid = task.status is not TaskStatus.QUEUED or attempt.status is not AttemptStatus.QUEUED or attempt.task_id != task.task_id or attempt.task_revision != task.revision or attempt.run_id != task.run_id or attempt.workspace_id != task.workspace_id
        if invalid:
            raise ResearchSpecialistError("RESEARCH_ATTEMPT_IDENTITY_INVALID")

    @classmethod
    def _event(cls, task: DepartmentTask, attempt: TaskAttempt, sequence: int, event_type: str, occurred_at: datetime, *, phase: str, milestone: str, data: dict[str, object] | None = None) -> TaskAttemptEventWrite:
        event_id = f"{attempt.attempt_id}:{sequence}:{event_type}"
        return TaskAttemptEventWrite(event_id=event_id, run_id=task.run_id, source=cls.SOURCE, source_event_id=event_id, task_id=task.task_id, task_revision=task.revision, attempt_id=attempt.attempt_id, attempt_number=attempt.attempt_number, workspace_id=task.workspace_id, sequence=sequence, event_type=event_type, occurred_at=occurred_at, phase=phase, milestone=milestone, data={} if data is None else data)
