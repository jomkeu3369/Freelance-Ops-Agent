"""Durable Task command inbox and checkpoint-safe command application."""

# ruff: noqa: E501, I001

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentTaskAttemptModel, AgentTaskCommandReceiptModel, AgentTaskEventModel, AgentTaskModel

from .task_contracts import AttemptStatus, RuntimeContractModel, TaskCommand, TaskCommandStatus, TaskCommandType, TaskRevisionConflictError, TaskStatus, ensure_attempt_transition, ensure_task_transition, ensure_workspace_scope


class TaskCommandInboxError(RuntimeError):
    pass


class TaskCommandConflictError(TaskCommandInboxError):
    pass


class TaskCommandPendingError(TaskCommandInboxError):
    pass


class TaskCommandAcceptance(RuntimeContractModel):
    command_id: UUID
    task_id: UUID
    task_revision: int = Field(ge=1)
    status: TaskCommandStatus
    target_revision: int = Field(ge=1)


class PostgresTaskCommandInbox:
    def __init__(self, database: PgVectorConnectionManager) -> None:
        self._database = database

    async def accept(self, command: TaskCommand) -> TaskCommandAcceptance:
        async with self._database.session() as session:
            existing = await session.get(AgentTaskCommandReceiptModel, command.command_id)
            if existing is not None:
                self._require_same(existing, command)
                return self._acceptance(existing)
            task = await self._locked_task(session, command)
            self._require_policy_revisions(task, command)
            now = datetime.now(UTC)
            status, target_revision = await self._apply_immediate(session, task, command, now)
            receipt = self._receipt(command, status, now)
            session.add(receipt)
            await session.flush()
            return TaskCommandAcceptance(command_id=command.command_id, task_id=command.task_id, task_revision=command.expected_revision, status=TaskCommandStatus(status), target_revision=target_revision)

    async def apply_soft_update_at_checkpoint(self, command_id: UUID, attempt_id: UUID, workspace_id: UUID) -> dict[str, object]:
        async with self._database.session() as session:
            receipt = await session.scalar(select(AgentTaskCommandReceiptModel).where(AgentTaskCommandReceiptModel.command_id == command_id).with_for_update())
            if receipt is None:
                raise TaskCommandInboxError("task command was not found")
            ensure_workspace_scope(workspace_id, receipt.workspace_id)
            if receipt.command_type != TaskCommandType.SOFT_UPDATE.value:
                raise TaskCommandInboxError("only soft update can be applied at a checkpoint")
            if receipt.status == TaskCommandStatus.APPLIED.value:
                return dict(receipt.payload_json)
            task = await session.scalar(select(AgentTaskModel).where(AgentTaskModel.task_id == receipt.task_id, AgentTaskModel.revision == receipt.task_revision).with_for_update())
            attempt = await session.scalar(select(AgentTaskAttemptModel).where(AgentTaskAttemptModel.attempt_id == attempt_id).with_for_update())
            if task is None or attempt is None or attempt.task_id != receipt.task_id or attempt.task_revision != receipt.task_revision or attempt.workspace_id != workspace_id:
                raise TaskRevisionConflictError("checkpoint attempt identity does not match task command")
            if TaskStatus(task.status) is not TaskStatus.CHECKPOINTED or AttemptStatus(attempt.status) is not AttemptStatus.CHECKPOINTED:
                raise TaskCommandPendingError("soft update requires a safe checkpoint")
            ensure_task_transition(TaskStatus(task.status), TaskStatus.RUNNING)
            ensure_attempt_transition(AttemptStatus(attempt.status), AttemptStatus.RUNNING)
            now = datetime.now(UTC)
            task.status = TaskStatus.RUNNING.value
            task.updated_at = now
            attempt.status = AttemptStatus.RUNNING.value
            attempt.updated_at = now
            receipt.status = TaskCommandStatus.APPLIED.value
            receipt.applied_at = now
            sequence = int(await session.scalar(select(func.coalesce(func.max(AgentTaskEventModel.sequence), 0)).where(AgentTaskEventModel.attempt_id == attempt_id))) + 1
            event_id = f"{attempt_id}:{sequence}:attempt.update_applied"
            session.add(AgentTaskEventModel(event_id=event_id, run_id=receipt.run_id,
                schema_version="task-attempt-telemetry-v1", source="task-control-v1",
                source_event_id=str(receipt.command_id), task_id=receipt.task_id,
                task_revision=receipt.task_revision, attempt_id=attempt_id,
                attempt_number=attempt.attempt_number, workspace_id=workspace_id, sequence=sequence,
                event_type="attempt.update_applied", phase="CONTROL", milestone="User instruction applied",
                occurred_at=now, received_at=now, data_json={"command_id": str(receipt.command_id)},
                delivery_status="PENDING", delivery_attempts=0, delivery_available_at=now))
            await session.flush()
            return dict(receipt.payload_json)

    async def _apply_immediate(self, session: AsyncSession, task: AgentTaskModel, command: TaskCommand, now: datetime) -> tuple[str, int]:
        current = TaskStatus(task.status)
        if not command.payload.keys() <= {"instruction", "objective_reference"}:
            raise TaskCommandInboxError("task command payload is unsupported")
        if command.type is TaskCommandType.SOFT_UPDATE:
            if set(command.payload) != {"instruction"} or not str(command.payload["instruction"]).strip():
                raise TaskCommandInboxError("soft update instruction is required")
            if current in {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.REJECTED, TaskStatus.SUPERSEDED}:
                raise TaskCommandConflictError("terminal task cannot be updated")
            return TaskCommandStatus.PENDING.value, task.revision
        if command.type is TaskCommandType.HARD_REDIRECT:
            if set(command.payload) != {"objective_reference"} or not str(command.payload["objective_reference"]).strip():
                raise TaskCommandInboxError("hard redirect objective reference is required")
            ensure_task_transition(current, TaskStatus.SUPERSEDED)
            await self._terminate_attempts(session, command, AttemptStatus.SUPERSEDED, now)
            task.status = TaskStatus.SUPERSEDED.value
            task.updated_at = now
            replacement = AgentTaskModel(task_id=task.task_id, revision=task.revision + 1, run_id=task.run_id, workspace_id=task.workspace_id, project_id=task.project_id, department=task.department, status=TaskStatus.SUBMITTED.value, priority=task.priority, dependency_task_ids=list(task.dependency_task_ids), execution_json=dict(task.execution_json), schema_version=task.schema_version, created_at=now, updated_at=now)
            session.add(replacement)
            return TaskCommandStatus.APPLIED.value, replacement.revision
        if command.type is TaskCommandType.CANCEL:
            if command.payload:
                raise TaskCommandInboxError("cancel payload must be empty")
            ensure_task_transition(current, TaskStatus.CANCELLED)
            await self._terminate_attempts(session, command, AttemptStatus.CANCELLED, now)
            task.status = TaskStatus.CANCELLED.value
            task.updated_at = now
            return TaskCommandStatus.APPLIED.value, task.revision
        raise TaskCommandInboxError("task command type is not supported by the control plane")

    @staticmethod
    async def _terminate_attempts(session: AsyncSession, command: TaskCommand, target: AttemptStatus, now: datetime) -> None:
        attempts = (await session.scalars(select(AgentTaskAttemptModel).where(AgentTaskAttemptModel.task_id == command.task_id, AgentTaskAttemptModel.task_revision == command.expected_revision).with_for_update())).all()
        for attempt in attempts:
            current = AttemptStatus(attempt.status)
            if current in {AttemptStatus.COMPLETED, AttemptStatus.FAILED, AttemptStatus.CANCELLED, AttemptStatus.SUPERSEDED}:
                continue
            ensure_attempt_transition(current, target)
            attempt.status = target.value
            attempt.finished_at = now if attempt.started_at is not None else None
            attempt.updated_at = now

    @staticmethod
    async def _locked_task(session: AsyncSession, command: TaskCommand) -> AgentTaskModel:
        task = await session.scalar(select(AgentTaskModel).where(AgentTaskModel.task_id == command.task_id, AgentTaskModel.revision == command.expected_revision).with_for_update())
        if task is None:
            raise TaskRevisionConflictError("task command revision is not available")
        ensure_workspace_scope(command.workspace_id, task.workspace_id)
        if task.run_id != command.run_id:
            raise TaskRevisionConflictError("task command run does not match task")
        return task

    @staticmethod
    def _require_policy_revisions(task: AgentTaskModel, command: TaskCommand) -> None:
        execution = dict(task.execution_json)
        if execution.get("authorization_revision") != command.authorization_revision or execution.get("budget_revision") != command.budget_revision:
            raise TaskCommandConflictError("task command policy revision is stale")

    @classmethod
    def _receipt(cls, command: TaskCommand, status: str, now: datetime) -> AgentTaskCommandReceiptModel:
        payload = dict(command.payload)
        return AgentTaskCommandReceiptModel(command_id=command.command_id, task_id=command.task_id, task_revision=command.expected_revision, run_id=command.run_id, workspace_id=command.workspace_id, attempt_id=command.attempt_id, command_type=command.type.value, idempotency_key=command.idempotency_key, requested_by=command.requested_by, requested_at=command.requested_at, authorization_revision=command.authorization_revision, budget_revision=command.budget_revision, payload_json=payload, payload_sha256=cls._payload_hash(payload), status=status, received_at=now, applied_at=now if status == TaskCommandStatus.APPLIED.value else None)

    @classmethod
    def _require_same(cls, receipt: AgentTaskCommandReceiptModel, command: TaskCommand) -> None:
        same = receipt.task_id == command.task_id and receipt.task_revision == command.expected_revision and receipt.run_id == command.run_id and receipt.workspace_id == command.workspace_id and receipt.attempt_id == command.attempt_id and receipt.command_type == command.type.value and receipt.idempotency_key == command.idempotency_key and receipt.requested_by == command.requested_by and receipt.requested_at == command.requested_at.astimezone(UTC) and receipt.authorization_revision == command.authorization_revision and receipt.budget_revision == command.budget_revision and receipt.payload_sha256 == cls._payload_hash(command.payload)
        if not same:
            raise TaskCommandConflictError("task command id conflicts with different data")

    @staticmethod
    def _payload_hash(payload: dict[str, object]) -> str:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _acceptance(receipt: AgentTaskCommandReceiptModel) -> TaskCommandAcceptance:
        target_revision = receipt.task_revision + 1 if receipt.command_type == TaskCommandType.HARD_REDIRECT.value else receipt.task_revision
        return TaskCommandAcceptance(command_id=receipt.command_id, task_id=receipt.task_id, task_revision=receipt.task_revision, status=TaskCommandStatus(receipt.status), target_revision=target_revision)
