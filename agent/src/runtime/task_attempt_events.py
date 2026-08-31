"""Append-only TaskAttempt telemetry persistence owned by the Agent runtime."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError

from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentTaskEventModel

TASK_ATTEMPT_EVENT_SCHEMA_VERSION = "task-attempt-telemetry-v1"
TASK_ATTEMPT_EVENT_TYPES = frozenset(("attempt.predicted", "attempt.queued", "attempt.started", "attempt.checkpointed", "attempt.failed", "attempt.retry_decided", "attempt.completed", "attempt.incident_finalized"))  # noqa: E501
FORBIDDEN_TASK_EVENT_KEYS = frozenset(("api_key", "chain_of_thought", "delegation_token", "prompt", "secret"))


class TaskAttemptEventConflictError(RuntimeError):
    pass


def _contains_forbidden_key(value: object) -> bool:
    if isinstance(value, Mapping):
        return any(str(key).lower() in FORBIDDEN_TASK_EVENT_KEYS or _contains_forbidden_key(item) for key, item in value.items())  # noqa: E501
    if isinstance(value, (list, tuple)):
        return any(_contains_forbidden_key(item) for item in value)
    return False


@dataclass(frozen=True, slots=True)
class TaskAttemptEventWrite:
    event_id: str
    run_id: UUID
    source: str
    source_event_id: str
    task_id: str
    attempt_id: str
    attempt_number: int
    workspace_id: UUID
    sequence: int
    event_type: str
    occurred_at: datetime
    data: Mapping[str, Any] = field(default_factory=dict)
    schema_version: str = TASK_ATTEMPT_EVENT_SCHEMA_VERSION

    def __post_init__(self) -> None:
        identifiers = (self.event_id, self.source, self.source_event_id, self.task_id, self.attempt_id)
        if not all(value.strip() for value in identifiers):
            raise ValueError("TaskAttempt event identifiers must not be blank")
        if len(self.event_id) > 128 or len(self.source_event_id) > 128 or len(self.task_id) > 128 or len(self.attempt_id) > 128 or len(self.source) > 64:  # noqa: E501
            raise ValueError("TaskAttempt event identifier exceeds its storage limit")
        if self.schema_version != TASK_ATTEMPT_EVENT_SCHEMA_VERSION:
            raise ValueError("TaskAttempt event schema version is unsupported")
        if self.event_type not in TASK_ATTEMPT_EVENT_TYPES:
            raise ValueError("TaskAttempt event type is unsupported")
        if self.attempt_number < 1 or self.sequence < 1:
            raise ValueError("TaskAttempt number and sequence must be positive")
        if self.occurred_at.tzinfo is None or self.occurred_at.utcoffset() is None:
            raise ValueError("TaskAttempt occurred_at must be timezone-aware")
        if _contains_forbidden_key(self.data):
            raise ValueError("TaskAttempt event data contains a forbidden secret or reasoning field")


@dataclass(frozen=True, slots=True)
class TaskAttemptEventRecord:
    event_id: str
    run_id: UUID
    schema_version: str
    source: str
    source_event_id: str
    task_id: str
    attempt_id: str
    attempt_number: int
    workspace_id: UUID
    sequence: int
    event_type: str
    occurred_at: datetime
    received_at: datetime
    data: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class TaskAttemptEventCursor:
    received_at: datetime
    event_id: str

    def __post_init__(self) -> None:
        if self.received_at.tzinfo is None or self.received_at.utcoffset() is None or not self.event_id.strip():
            raise ValueError("TaskAttempt cursor is invalid")


class TaskAttemptEventStore(Protocol):
    async def append(self, event: TaskAttemptEventWrite) -> TaskAttemptEventRecord: ...

    async def list_for_run(self, run_id: UUID, *, after: TaskAttemptEventCursor | None = None, limit: int = 1_000) -> list[TaskAttemptEventRecord]: ...  # noqa: E501


def _record_from_write(event: TaskAttemptEventWrite, received_at: datetime) -> TaskAttemptEventRecord:
    return TaskAttemptEventRecord(event_id=event.event_id, run_id=event.run_id, schema_version=event.schema_version, source=event.source, source_event_id=event.source_event_id, task_id=event.task_id, attempt_id=event.attempt_id, attempt_number=event.attempt_number, workspace_id=event.workspace_id, sequence=event.sequence, event_type=event.event_type, occurred_at=event.occurred_at.astimezone(UTC), received_at=received_at.astimezone(UTC), data=dict(event.data))  # noqa: E501


def _same_event(record: TaskAttemptEventRecord, event: TaskAttemptEventWrite) -> bool:
    return record.event_id == event.event_id and record.run_id == event.run_id and record.schema_version == event.schema_version and record.source == event.source and record.source_event_id == event.source_event_id and record.task_id == event.task_id and record.attempt_id == event.attempt_id and record.attempt_number == event.attempt_number and record.workspace_id == event.workspace_id and record.sequence == event.sequence and record.event_type == event.event_type and record.occurred_at == event.occurred_at.astimezone(UTC) and dict(record.data) == dict(event.data)  # noqa: E501


class InMemoryTaskAttemptEventStore:
    def __init__(self) -> None:
        self._records: dict[str, TaskAttemptEventRecord] = {}
        self._source_keys: dict[tuple[str, str], str] = {}
        self._attempt_sequences: dict[tuple[str, int], str] = {}
        self._lock = asyncio.Lock()

    async def append(self, event: TaskAttemptEventWrite) -> TaskAttemptEventRecord:
        async with self._lock:
            direct_id = event.event_id if event.event_id in self._records else None
            conflict_ids = (direct_id, self._source_keys.get((event.source, event.source_event_id)), self._attempt_sequences.get((event.attempt_id, event.sequence)))  # noqa: E501
            conflicts = [self._records[event_id] for event_id in conflict_ids if event_id is not None]
            if conflicts:
                if all(_same_event(record, event) for record in conflicts):
                    return conflicts[0]
                raise TaskAttemptEventConflictError("TaskAttempt event idempotency key conflicts with different data")
            record = _record_from_write(event, datetime.now(UTC))
            self._records[record.event_id] = record
            self._source_keys[(record.source, record.source_event_id)] = record.event_id
            self._attempt_sequences[(record.attempt_id, record.sequence)] = record.event_id
            return record

    async def list_for_run(self, run_id: UUID, *, after: TaskAttemptEventCursor | None = None, limit: int = 1_000) -> list[TaskAttemptEventRecord]:  # noqa: E501
        if not 1 <= limit <= 5_000:
            raise ValueError("TaskAttempt event limit must be between 1 and 5000")
        async with self._lock:
            selected = [record for record in self._records.values() if record.run_id == run_id and (after is None or (record.received_at, record.event_id) > (after.received_at, after.event_id))]  # noqa: E501
            return sorted(selected, key=lambda record: (record.received_at, record.event_id))[:limit]


class PostgresTaskAttemptEventStore:
    def __init__(self, database: PgVectorConnectionManager) -> None:
        self._database = database

    async def initialize(self) -> None:
        await self._database.verify_runtime_tables()

    async def append(self, event: TaskAttemptEventWrite) -> TaskAttemptEventRecord:
        received_at = datetime.now(UTC)
        model = AgentTaskEventModel(event_id=event.event_id, run_id=event.run_id, schema_version=event.schema_version, source=event.source, source_event_id=event.source_event_id, task_id=event.task_id, attempt_id=event.attempt_id, attempt_number=event.attempt_number, workspace_id=event.workspace_id, sequence=event.sequence, event_type=event.event_type, occurred_at=event.occurred_at.astimezone(UTC), received_at=received_at, data_json=dict(event.data))  # noqa: E501
        try:
            async with self._database.session() as session:
                session.add(model)
                await session.flush()
        except IntegrityError as error:
            existing = await self._find_conflict(event)
            if existing is not None and _same_event(existing, event):
                return existing
            raise TaskAttemptEventConflictError("TaskAttempt event idempotency key conflicts with different data") from error  # noqa: E501
        return self._record(model)

    async def list_for_run(self, run_id: UUID, *, after: TaskAttemptEventCursor | None = None, limit: int = 1_000) -> list[TaskAttemptEventRecord]:  # noqa: E501
        if not 1 <= limit <= 5_000:
            raise ValueError("TaskAttempt event limit must be between 1 and 5000")
        statement = select(AgentTaskEventModel).where(AgentTaskEventModel.run_id == run_id)
        if after is not None:
            statement = statement.where(or_(AgentTaskEventModel.received_at > after.received_at, and_(AgentTaskEventModel.received_at == after.received_at, AgentTaskEventModel.event_id > after.event_id)))  # noqa: E501
        statement = statement.order_by(AgentTaskEventModel.received_at, AgentTaskEventModel.event_id).limit(limit)
        async with self._database.session() as session:
            models = list((await session.scalars(statement)).all())
        return [self._record(model) for model in models]

    async def _find_conflict(self, event: TaskAttemptEventWrite) -> TaskAttemptEventRecord | None:
        statement = select(AgentTaskEventModel).where(or_(AgentTaskEventModel.event_id == event.event_id, and_(AgentTaskEventModel.source == event.source, AgentTaskEventModel.source_event_id == event.source_event_id), and_(AgentTaskEventModel.attempt_id == event.attempt_id, AgentTaskEventModel.sequence == event.sequence))).limit(1)  # noqa: E501
        async with self._database.session() as session:
            model = await session.scalar(statement)
        return None if model is None else self._record(model)

    @staticmethod
    def _record(model: AgentTaskEventModel) -> TaskAttemptEventRecord:
        return TaskAttemptEventRecord(event_id=model.event_id, run_id=model.run_id, schema_version=model.schema_version, source=model.source, source_event_id=model.source_event_id, task_id=model.task_id, attempt_id=model.attempt_id, attempt_number=model.attempt_number, workspace_id=model.workspace_id, sequence=model.sequence, event_type=model.event_type, occurred_at=model.occurred_at, received_at=model.received_at, data=dict(model.data_json))  # noqa: E501
