"""PostgreSQL-backed FIFO dispatcher with non-authoritative scheduler shadow ranking."""

# ruff: noqa: E501, I001

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Collection
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import and_, or_, select, func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentResearchPoolModel, AgentSchedulerEntryModel, AgentTaskAttemptModel, AgentTaskModel, AgentWorkerCapacityEventModel

from .scheduler import HierarchicalShadowScheduler, SchedulerCandidate, SchedulerQueueKind, SchedulerRank, ShadowAdmissionDecision, ShadowAdmissionReason, ShadowAdmissionSnapshot, WorkerCapacitySnapshot


class SchedulerStoreError(RuntimeError):
    pass


class SchedulerObservationConflictError(SchedulerStoreError):
    pass


class SchedulerClaimConflictError(SchedulerStoreError):
    pass


@dataclass(frozen=True, slots=True)
class SchedulerObservation:
    candidate: SchedulerCandidate
    shadow_admission: ShadowAdmissionSnapshot


@dataclass(frozen=True, slots=True)
class ClaimedSchedulerEntry:
    candidate: SchedulerCandidate
    claim_id: UUID
    claimed_by: str
    lease_until: datetime
    rank: SchedulerRank


class PostgresShadowSchedulerStore:
    def __init__(self, database: PgVectorConnectionManager, scheduler: HierarchicalShadowScheduler | None = None) -> None:
        self._database = database
        self._scheduler = scheduler or HierarchicalShadowScheduler()

    async def record_capacity(self, event_id: UUID, snapshot: WorkerCapacitySnapshot, *, source: str) -> WorkerCapacitySnapshot:
        if not source.strip():
            raise ValueError("capacity event source must not be blank")
        model = AgentWorkerCapacityEventModel(event_id=event_id, resource_pool=snapshot.resource_pool, worker_count=snapshot.worker_count, captured_at=snapshot.captured_at.astimezone(UTC), source=source, policy_version=self._scheduler.policy.policy_version)
        try:
            async with self._database.session() as session:
                session.add(model)
                await session.flush()
        except IntegrityError as error:
            async with self._database.session() as session:
                existing = await session.get(AgentWorkerCapacityEventModel, event_id)
            if existing is not None and existing.resource_pool == snapshot.resource_pool and existing.worker_count == snapshot.worker_count and existing.captured_at == snapshot.captured_at.astimezone(UTC) and existing.source == source and existing.policy_version == self._scheduler.policy.policy_version:
                return snapshot
            raise SchedulerObservationConflictError("capacity event id already exists with different data") from error
        return snapshot

    async def observe_queued(self, candidate: SchedulerCandidate, capacity: WorkerCapacitySnapshot) -> SchedulerObservation:
        if candidate.resource_pool != capacity.resource_pool:
            raise SchedulerObservationConflictError("scheduler candidate and capacity resource pools do not match")
        async with self._database.session() as session:
            task = await session.get(AgentTaskModel, (candidate.task_id, candidate.task_revision), with_for_update=True)
            attempt = await session.get(AgentTaskAttemptModel, candidate.attempt_id, with_for_update=True)
            if attempt is None or task is None:
                raise SchedulerStoreError("scheduler candidate task or attempt was not found")
            if attempt.task_id != candidate.task_id or attempt.task_revision != candidate.task_revision or attempt.workspace_id != candidate.workspace_id or task.workspace_id != candidate.workspace_id:
                raise SchedulerObservationConflictError("scheduler candidate identity does not match durable task state")
            if attempt.status != "QUEUED" or task.status != "QUEUED":
                raise SchedulerStoreError("scheduler observes only durable queued task attempts")
            if attempt.predicted_service_runtime_seconds != candidate.predicted_runtime_seconds or attempt.predictor_version != candidate.predictor_version or task.priority != candidate.priority:
                raise SchedulerObservationConflictError("scheduler candidate snapshot does not match prediction or priority")
            existing = await session.get(AgentSchedulerEntryModel, candidate.attempt_id, with_for_update=True)
            if existing is not None:
                if self._same_candidate(existing, candidate):
                    return SchedulerObservation(candidate, self._admission(existing))
                raise SchedulerObservationConflictError("scheduler attempt is already observed with different data")
            statement = select(AgentSchedulerEntryModel).where(AgentSchedulerEntryModel.resource_pool == candidate.resource_pool, AgentSchedulerEntryModel.entry_status.in_(("PENDING", "CLAIMED")))
            pending = [self._candidate(model) for model in (await session.scalars(statement)).all()]
            admission = self._scheduler.assess(candidate, pending, capacity)
            now = datetime.now(UTC)
            session.add(AgentSchedulerEntryModel(attempt_id=candidate.attempt_id, task_id=candidate.task_id, task_revision=candidate.task_revision, workspace_id=candidate.workspace_id, resource_pool=candidate.resource_pool, queue_kind=candidate.queue_kind.value, entry_status="PENDING", priority=candidate.priority, predicted_runtime_seconds=candidate.predicted_runtime_seconds, predictor_version=candidate.predictor_version, enqueued_at=candidate.enqueued_at.astimezone(UTC), available_at=candidate.available_at.astimezone(UTC), actual_policy_version=self._scheduler.policy.actual_policy_version, shadow_policy_version=self._scheduler.policy.policy_version, shadow_decision=admission.decision.value, shadow_reason=admission.reason.value, shadow_available_at=admission.shadow_available_at, admission_snapshot=self._admission_json(admission), created_at=now, updated_at=now))
            await session.flush()
            return SchedulerObservation(candidate, admission)

    async def claim_next(self, resource_pool: str, claimed_by: str, now: datetime, *, lease_seconds: int = 60, dispatch_count: int = 0, worker_count: int = 1, workspace_ids: Collection[UUID] | None = None, attempt_ids: Collection[UUID] | None = None) -> ClaimedSchedulerEntry | None:
        if not resource_pool.strip() or not claimed_by.strip() or not 1 <= lease_seconds <= 300 or dispatch_count < 0 or worker_count < 1:
            raise ValueError("scheduler claim options are invalid")
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("scheduler claim time must be timezone-aware")
        current = now.astimezone(UTC)
        async with self._database.session() as session:
            await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:pool, 11))"), {"pool": resource_pool})
            await session.execute(insert(AgentResearchPoolModel).values(resource_pool=resource_pool, worker_count=worker_count).on_conflict_do_nothing())
            pool = await session.get(AgentResearchPoolModel, resource_pool)
            if pool is None or pool.worker_count != worker_count:
                raise SchedulerClaimConflictError("Research pool capacity differs from durable configuration")
            active = await session.scalar(select(func.count()).select_from(AgentSchedulerEntryModel).where(AgentSchedulerEntryModel.resource_pool == resource_pool, or_(AgentSchedulerEntryModel.entry_status == "DISPATCHED", and_(AgentSchedulerEntryModel.entry_status == "CLAIMED", AgentSchedulerEntryModel.lease_until > current))))
            if int(active or 0) >= pool.worker_count:
                return None
            statement = select(AgentSchedulerEntryModel).where(AgentSchedulerEntryModel.resource_pool == resource_pool, AgentSchedulerEntryModel.available_at <= current, or_(AgentSchedulerEntryModel.entry_status == "PENDING", and_(AgentSchedulerEntryModel.entry_status == "CLAIMED", AgentSchedulerEntryModel.lease_until <= current))).with_for_update(skip_locked=True)
            if workspace_ids is not None:
                statement = statement.where(AgentSchedulerEntryModel.workspace_id.in_(workspace_ids))
            if attempt_ids is not None:
                statement = statement.where(AgentSchedulerEntryModel.attempt_id.in_(attempt_ids))
            models = list((await session.scalars(statement)).all())
            if not models:
                return None
            ranks = self._scheduler.rank([self._candidate(model) for model in models], current, dispatch_count=dispatch_count)
            rank_by_attempt = {rank.attempt_id: rank for rank in ranks}
            selected = min(models, key=lambda model: rank_by_attempt[model.attempt_id].actual_rank)
            for model in models:
                rank = rank_by_attempt[model.attempt_id]
                model.last_actual_rank = rank.actual_rank
                model.last_shadow_rank = rank.shadow_rank
                model.last_shadow_score = rank.shadow_score
                model.last_shadow_lane = rank.shadow_lane.value
                model.updated_at = current
                if model.entry_status == "CLAIMED" and model.lease_until is not None and model.lease_until <= current:
                    model.entry_status = "PENDING"
                    model.claim_id = None
                    model.claimed_by = None
                    model.lease_until = None
            claim_id = uuid4()
            lease_until = current + timedelta(seconds=lease_seconds)
            selected.entry_status = "CLAIMED"
            selected.claim_id = claim_id
            selected.claimed_by = claimed_by
            selected.lease_until = lease_until
            await session.flush()
            return ClaimedSchedulerEntry(self._candidate(selected), claim_id, claimed_by, lease_until, rank_by_attempt[selected.attempt_id])

    async def acknowledge_dispatch(self, attempt_id: UUID, claim_id: UUID, claimed_by: str) -> None:
        async with self._database.session() as session:
            model = await session.get(AgentSchedulerEntryModel, attempt_id, with_for_update=True)
            if model is None or model.entry_status != "CLAIMED" or model.claim_id != claim_id or model.claimed_by != claimed_by or model.lease_until is None or model.lease_until <= datetime.now(UTC):
                raise SchedulerClaimConflictError("scheduler dispatch claim does not match")
            model.entry_status = "DISPATCHED"
            model.updated_at = datetime.now(UTC)

    @staticmethod
    def _candidate(model: AgentSchedulerEntryModel) -> SchedulerCandidate:
        return SchedulerCandidate(model.attempt_id, model.task_id, model.task_revision, model.workspace_id, model.resource_pool, model.priority, model.predicted_runtime_seconds, model.predictor_version, SchedulerQueueKind(model.queue_kind), model.enqueued_at, model.available_at)

    @staticmethod
    def _same_candidate(model: AgentSchedulerEntryModel, candidate: SchedulerCandidate) -> bool:
        return PostgresShadowSchedulerStore._candidate(model) == candidate

    @staticmethod
    def _admission(model: AgentSchedulerEntryModel) -> ShadowAdmissionSnapshot:
        value = model.admission_snapshot
        shadow_available = value.get("shadow_available_at")
        return ShadowAdmissionSnapshot(ShadowAdmissionDecision(str(value["decision"])), ShadowAdmissionReason(str(value["reason"])), float(value["global_drain_seconds"]), float(value["workspace_drain_seconds"]), float(value["priority_drain_seconds"]), bool(value["scale_requested"]), int(value["projected_worker_count"]), None if shadow_available is None else datetime.fromisoformat(str(shadow_available)), str(value["policy_version"]))

    @staticmethod
    def _admission_json(admission: ShadowAdmissionSnapshot) -> dict[str, object]:
        return {"decision": admission.decision.value, "reason": admission.reason.value, "global_drain_seconds": admission.global_drain_seconds, "workspace_drain_seconds": admission.workspace_drain_seconds, "priority_drain_seconds": admission.priority_drain_seconds, "scale_requested": admission.scale_requested, "projected_worker_count": admission.projected_worker_count, "shadow_available_at": None if admission.shadow_available_at is None else admission.shadow_available_at.isoformat(), "policy_version": admission.policy_version}
