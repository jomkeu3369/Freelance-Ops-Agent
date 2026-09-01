"""Authoritative TaskAttempt evaluation assembly and versioned release persistence."""

# ruff: noqa: E501, I001

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError

from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentRuntimeReleaseModel, AgentSchedulerEntryModel, AgentTaskAttemptModel, AgentTaskModel, AgentWorkerCapacityEventModel

from .runtime_evaluation import RuntimeEvaluationReport, RuntimeReleaseStatus, TaskAttemptEvaluationRecord


class RuntimeReleaseKind(StrEnum):
    RUNTIME_PREDICTOR = "RUNTIME_PREDICTOR"
    SCHEDULER_POLICY = "SCHEDULER_POLICY"


class RuntimeEvaluationStoreError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RuntimeEvaluationBatch:
    records: list[TaskAttemptEvaluationRecord]
    source_terminal_count: int
    load_band_count: int


@dataclass(frozen=True, slots=True)
class RuntimeReleaseRecord:
    release_id: UUID
    release_kind: RuntimeReleaseKind
    version: str
    resource_pool: str
    artifact_reference: str
    artifact_sha256: str
    dataset_fingerprint: str
    status: RuntimeReleaseStatus
    policy_version: str
    created_at: datetime
    approved_at: datetime | None


class PostgresRuntimeEvaluationStore:
    def __init__(self, database: PgVectorConnectionManager) -> None:
        self._database = database

    async def assemble(self, *, since: datetime, until: datetime, resource_pool: str | None = None) -> RuntimeEvaluationBatch:
        if since.tzinfo is None or until.tzinfo is None or since.utcoffset() is None or until.utcoffset() is None or since >= until:
            raise ValueError("runtime evaluation window must be timezone-aware and increasing")
        terminal_filter = (AgentTaskAttemptModel.status.in_(("COMPLETED", "FAILED")), AgentTaskAttemptModel.finished_at >= since.astimezone(UTC), AgentTaskAttemptModel.finished_at < until.astimezone(UTC))
        join_condition = and_(AgentTaskModel.task_id == AgentTaskAttemptModel.task_id, AgentTaskModel.revision == AgentTaskAttemptModel.task_revision)
        statement = select(AgentTaskAttemptModel, AgentTaskModel, AgentSchedulerEntryModel).join(AgentTaskModel, join_condition).join(AgentSchedulerEntryModel, AgentSchedulerEntryModel.attempt_id == AgentTaskAttemptModel.attempt_id).where(*terminal_filter)
        capacity_statement = select(func.count(func.distinct(AgentWorkerCapacityEventModel.worker_count))).where(AgentWorkerCapacityEventModel.captured_at >= since.astimezone(UTC), AgentWorkerCapacityEventModel.captured_at < until.astimezone(UTC))
        if resource_pool is not None:
            if not resource_pool.strip():
                raise ValueError("runtime evaluation resource pool must not be blank")
            statement = statement.where(AgentSchedulerEntryModel.resource_pool == resource_pool)
            capacity_statement = capacity_statement.where(AgentWorkerCapacityEventModel.resource_pool == resource_pool)
        async with self._database.session() as session:
            source_terminal_count = int(await session.scalar(select(func.count()).select_from(AgentTaskAttemptModel).where(*terminal_filter)) or 0) if resource_pool is None else int(await session.scalar(select(func.count()).select_from(AgentTaskAttemptModel).join(AgentSchedulerEntryModel, AgentSchedulerEntryModel.attempt_id == AgentTaskAttemptModel.attempt_id).where(*terminal_filter, AgentSchedulerEntryModel.resource_pool == resource_pool)) or 0)
            rows = (await session.execute(statement)).all()
            load_band_count = int(await session.scalar(capacity_statement) or 0)
        records = [self._record(attempt, task, entry) for attempt, task, entry in rows]
        return RuntimeEvaluationBatch(records, source_terminal_count, load_band_count)

    async def record_release(self, release_id: UUID, release_kind: RuntimeReleaseKind, version: str, resource_pool: str, artifact_reference: str, artifact_sha256: str, dataset_fingerprint: str, report: RuntimeEvaluationReport) -> RuntimeReleaseRecord:
        values = (version, resource_pool, artifact_reference)
        if any(not value.strip() for value in values) or not _sha256(artifact_sha256) or not _sha256(dataset_fingerprint):
            raise ValueError("runtime release identity, artifact and dataset hashes are invalid")
        now = datetime.now(UTC)
        approved_at = now if report.status is RuntimeReleaseStatus.APPROVED else None
        model = AgentRuntimeReleaseModel(release_id=release_id, release_kind=release_kind.value, version=version, resource_pool=resource_pool, artifact_reference=artifact_reference, artifact_sha256=artifact_sha256, dataset_fingerprint=dataset_fingerprint, status=report.status.value, report_json=_json_value(asdict(report)), policy_version=report.policy_version, created_at=now, approved_at=approved_at)
        try:
            async with self._database.session() as session:
                session.add(model)
                await session.flush()
        except IntegrityError as error:
            async with self._database.session() as session:
                existing = await session.scalar(select(AgentRuntimeReleaseModel).where(AgentRuntimeReleaseModel.release_kind == release_kind.value, AgentRuntimeReleaseModel.version == version, AgentRuntimeReleaseModel.resource_pool == resource_pool))
            if existing is not None and existing.release_id == release_id and existing.artifact_reference == artifact_reference and existing.artifact_sha256 == artifact_sha256 and existing.dataset_fingerprint == dataset_fingerprint and existing.status == report.status.value and existing.policy_version == report.policy_version:
                return self._release(existing)
            raise RuntimeEvaluationStoreError("runtime release version already exists with different evidence") from error
        return self._release(model)

    @staticmethod
    def _record(attempt: AgentTaskAttemptModel, task: AgentTaskModel, entry: AgentSchedulerEntryModel) -> TaskAttemptEvaluationRecord:
        return TaskAttemptEvaluationRecord(attempt.attempt_id, attempt.task_id, attempt.workspace_id, attempt.attempt_number, task.priority, entry.resource_pool, attempt.queued_at, attempt.started_at, attempt.finished_at, attempt.predicted_service_runtime_seconds, attempt.predictor_version, attempt.status == "COMPLETED", attempt.retry_reason)

    @staticmethod
    def _release(model: AgentRuntimeReleaseModel) -> RuntimeReleaseRecord:
        return RuntimeReleaseRecord(model.release_id, RuntimeReleaseKind(model.release_kind), model.version, model.resource_pool, model.artifact_reference, model.artifact_sha256, model.dataset_fingerprint, RuntimeReleaseStatus(model.status), model.policy_version, model.created_at, model.approved_at)


def runtime_dataset_fingerprint(records: list[TaskAttemptEvaluationRecord]) -> str:
    if not records:
        raise ValueError("runtime evaluation dataset must not be empty")
    rows = [{"attempt_id": str(record.attempt_id), "task_id": str(record.task_id), "workspace_id": str(record.workspace_id), "attempt_number": record.attempt_number, "priority": record.priority, "resource_pool": record.resource_pool, "queued_at": None if record.queued_at is None else record.queued_at.isoformat(), "started_at": None if record.started_at is None else record.started_at.isoformat(), "finished_at": None if record.finished_at is None else record.finished_at.isoformat(), "predicted_runtime_seconds": record.predicted_runtime_seconds, "predictor_version": record.predictor_version, "succeeded": record.succeeded, "retry_reason": record.retry_reason} for record in sorted(records, key=lambda value: str(value.attempt_id))]
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _sha256(value: str) -> bool:
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def _json_value(value: object) -> Any:
    if isinstance(value, StrEnum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value
