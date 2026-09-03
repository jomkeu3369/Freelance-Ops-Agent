"""Atomic Research start/finish fencing and conservative expired-worker recovery."""

# ruff: noqa: E501, I001

from collections.abc import Collection
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentResearchBudgetModel, AgentRunStateModel, AgentSchedulerEntryModel, AgentTaskAttemptModel, AgentTaskEventModel, AgentTaskModel

from .task_attempt_events import TaskAttemptEventWrite
from .task_contracts import AttemptStatus, DepartmentTask, TaskAttempt
from .task_registry import PostgresTaskRegistry
from .task_scheduler_store import ClaimedSchedulerEntry, SchedulerClaimConflictError


class PostgresResearchOwnership:
    def __init__(self, database: PgVectorConnectionManager) -> None:
        self._database = database

    async def begin(self, task: DepartmentTask, attempt: TaskAttempt, claim: ClaimedSchedulerEntry, event: TaskAttemptEventWrite) -> None:
        async with self._database.session() as session:
            current_task, current_attempt, entry = await self._locked(session, claim)
            now = datetime.now(UTC)
            self._require_owner(entry, claim, now)
            if current_task.status != "QUEUED" or current_attempt.status != "QUEUED" or current_task.execution_json != task.execution.model_dump(mode="json"):
                raise SchedulerClaimConflictError("Research start snapshot is no longer current")
            run = await session.get(AgentRunStateModel, task.run_id, with_for_update=True)
            if run is None or run.status in {"CANCELLED", "FAILED"}:
                raise SchedulerClaimConflictError("Research parent run no longer permits execution")
            budget = await session.get(AgentResearchBudgetModel, task.run_id, with_for_update=True)
            if budget is None or budget.workspace_id != task.workspace_id or budget.shadow_status != "RESERVED" or budget.shadow_json != task.execution.budget.model_dump(mode="json"):
                raise SchedulerClaimConflictError("Research shadow budget is not reserved")
            budget.shadow_status = "RUNNING"
            PostgresTaskRegistry._require_event_identity(current_attempt, event, AttemptStatus.RUNNING)
            current_task.status = current_attempt.status = "RUNNING"
            current_task.updated_at = current_attempt.updated_at = now
            current_attempt.started_at = now
            # Hard execution timeout plus a cancellation/DB cleanup margin. No automatic heartbeat extension.
            entry.lease_until = now + timedelta(seconds=task.execution.budget.max_duration_seconds + 30)
            entry.updated_at = now
            session.add(PostgresTaskRegistry._event_model(await self._sequence(session, replace(event, occurred_at=now)), now))

    async def finish(self, task: DepartmentTask, attempt: TaskAttempt, claim: ClaimedSchedulerEntry, event: TaskAttemptEventWrite) -> None:
        async with self._database.session() as session:
            current_task, current_attempt, entry = await self._locked(session, claim)
            now = datetime.now(UTC)
            self._require_owner(entry, claim, now)
            if current_task.status != "RUNNING" or current_attempt.status != "RUNNING":
                raise SchedulerClaimConflictError("Research result has been superseded")
            run = await session.get(AgentRunStateModel, task.run_id)
            if run is None or run.status in {"CANCELLED", "FAILED"}:
                event = replace(event, event_type="attempt.failed", data={"failure_code": "PARENT_RUN_TERMINATED", "task_terminal": True, "usage_unknown": True})
            target = AttemptStatus.COMPLETED if event.event_type == "attempt.completed" else AttemptStatus.FAILED
            PostgresTaskRegistry._require_event_identity(current_attempt, event, target)
            current_task.status = current_attempt.status = target.value
            current_task.updated_at = current_attempt.updated_at = now
            current_attempt.finished_at = now
            self._release(entry, "FINISHED", now)
            await self._settle_shadow(session, task.run_id, event)
            session.add(PostgresTaskRegistry._event_model(await self._sequence(session, replace(event, occurred_at=now)), now))

    async def recover_expired(self, resource_pool: str, workspace_ids: Collection[UUID], *, now: datetime | None = None) -> int:
        current = now or datetime.now(UTC)
        if current.tzinfo is None or current.utcoffset() is None:
            raise ValueError("Research recovery requires a timezone-aware time")
        recovered = 0
        async with self._database.session() as session:
            await self._pool_lock(session, resource_pool)
            entries = list((await session.scalars(select(AgentSchedulerEntryModel).where(AgentSchedulerEntryModel.resource_pool == resource_pool, AgentSchedulerEntryModel.workspace_id.in_(workspace_ids), AgentSchedulerEntryModel.entry_status.in_(("CLAIMED", "DISPATCHED")), AgentSchedulerEntryModel.lease_until <= current).order_by(AgentSchedulerEntryModel.attempt_id).limit(100))).all())
            for entry in entries:
                task = await session.get(AgentTaskModel, (entry.task_id, entry.task_revision), with_for_update=True)
                attempt = await session.get(AgentTaskAttemptModel, entry.attempt_id, with_for_update=True)
                # ACK may race the initial scan, so lock and reread the entry after task/attempt locks.
                await session.refresh(entry, with_for_update=True)
                if entry.lease_until is None or entry.lease_until > current or entry.entry_status not in {"CLAIMED", "DISPATCHED"}:
                    continue
                if task is None or attempt is None:
                    raise SchedulerClaimConflictError("Research recovery reference is missing")
                if task.status == "QUEUED" and attempt.status == "QUEUED" and attempt.started_at is None:
                    self._release(entry, "PENDING", current)
                elif task.status == "RUNNING" and attempt.status == "RUNNING":
                    event_id = f"{attempt.attempt_id}:worker-lost"
                    event = TaskAttemptEventWrite(event_id=event_id, source="research-read-worker-v1", source_event_id=event_id, run_id=task.run_id, workspace_id=task.workspace_id, task_id=task.task_id, task_revision=task.revision, attempt_id=attempt.attempt_id, attempt_number=attempt.attempt_number, sequence=1, event_type="attempt.failed", occurred_at=current, phase="VERIFICATION", milestone="Research worker lease expired", data={"failure_code": "WORKER_LOST", "task_terminal": True, "usage_unknown": True})
                    session.add(PostgresTaskRegistry._event_model(await self._sequence(session, event), current))
                    task.status = attempt.status = "FAILED"
                    task.updated_at = attempt.updated_at = current
                    attempt.finished_at = current
                    self._release(entry, "FINISHED", current)
                    await self._settle_shadow(session, task.run_id, event)
                else:
                    # Cancellation/redirects retain their terminal states; stale workers cannot finish them.
                    self._release(entry, "CANCELLED", current)
                    budget = await session.get(AgentResearchBudgetModel, task.run_id, with_for_update=True)
                    if budget is not None and budget.shadow_status == "RUNNING":
                        budget.shadow_status = "UNKNOWN"
                recovered += 1
        return recovered

    @staticmethod
    async def _pool_lock(session: AsyncSession, resource_pool: str) -> None:
        await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:pool, 11))"), {"pool": resource_pool})

    async def _locked(self, session: AsyncSession, claim: ClaimedSchedulerEntry) -> tuple[AgentTaskModel, AgentTaskAttemptModel, AgentSchedulerEntryModel]:
        candidate = claim.candidate
        await self._pool_lock(session, candidate.resource_pool)
        reference = await session.get(AgentTaskModel, (candidate.task_id, candidate.task_revision))
        if reference is not None:
            await session.get(AgentRunStateModel, reference.run_id, with_for_update=True)
        task = await session.get(AgentTaskModel, (candidate.task_id, candidate.task_revision), with_for_update=True, populate_existing=True)
        attempt = await session.get(AgentTaskAttemptModel, candidate.attempt_id, with_for_update=True)
        entry = await session.get(AgentSchedulerEntryModel, candidate.attempt_id, with_for_update=True)
        if task is None or attempt is None or entry is None or task.workspace_id != candidate.workspace_id or attempt.workspace_id != task.workspace_id or attempt.task_id != task.task_id or attempt.task_revision != task.revision or attempt.run_id != task.run_id or entry.resource_pool != candidate.resource_pool:
            raise SchedulerClaimConflictError("Research execution reference does not match")
        return task, attempt, entry

    @staticmethod
    async def _settle_shadow(session: AsyncSession, run_id: UUID, event: TaskAttemptEventWrite) -> None:
        budget = await session.get(AgentResearchBudgetModel, run_id, with_for_update=True)
        if budget is None:
            raise SchedulerClaimConflictError("Research budget settlement is missing")
        result = event.data.get("result")
        if event.event_type == "attempt.completed" and isinstance(result, dict):
            budget.shadow_status = "COMPLETED"
            budget.shadow_usage_json = {key: result[key] for key in ("model_calls", "tool_calls", "input_tokens", "output_tokens", "search_credits") if key in result}
        else:
            budget.shadow_status = "UNKNOWN"

    @staticmethod
    def _require_owner(entry: AgentSchedulerEntryModel, claim: ClaimedSchedulerEntry, now: datetime) -> None:
        if entry.entry_status != "DISPATCHED" or entry.claim_id != claim.claim_id or entry.claimed_by != claim.claimed_by or entry.lease_until is None or entry.lease_until <= now:
            raise SchedulerClaimConflictError("Research execution lease is no longer owned")

    @staticmethod
    def _release(entry: AgentSchedulerEntryModel, status: str, now: datetime) -> None:
        entry.entry_status = status
        entry.claim_id = None
        entry.claimed_by = None
        entry.lease_until = None
        entry.updated_at = now

    @staticmethod
    async def _sequence(session: AsyncSession, event: TaskAttemptEventWrite) -> TaskAttemptEventWrite:
        sequence = int(await session.scalar(select(func.coalesce(func.max(AgentTaskEventModel.sequence), 0)).where(AgentTaskEventModel.attempt_id == event.attempt_id)) or 0) + 1
        event_id = f"{event.attempt_id}:{sequence}:{event.event_type}"
        return replace(event, sequence=sequence, event_id=event_id, source_event_id=event_id)
