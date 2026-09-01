"""Query-only operational snapshot for the asynchronous Agent runtime."""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select

from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentProviderCircuitModel, AgentRuntimeReleaseModel, AgentSchedulerEntryModel


@dataclass(frozen=True, slots=True)
class RuntimeOperationalSnapshot:
    resource_pool: str
    captured_at: datetime
    queue_depth: int
    retry_queue_depth: int
    oldest_ready_age_seconds: float
    active_claim_count: int
    expired_lease_count: int
    shadow_rank_disagreement_count: int
    open_provider_circuit_count: int
    approved_release_count: int


class PostgresRuntimeOperationalMetrics:
    def __init__(self, database: PgVectorConnectionManager) -> None:
        self._database = database

    async def snapshot(self, resource_pool: str, *, now: datetime | None = None) -> RuntimeOperationalSnapshot:
        if not resource_pool.strip():
            raise ValueError("runtime metrics resource pool must not be blank")
        selected_time = datetime.now(UTC) if now is None else now
        if selected_time.tzinfo is None or selected_time.utcoffset() is None:
            raise ValueError("runtime metrics time must be timezone-aware")
        captured_at = selected_time.astimezone(UTC)
        pool = AgentSchedulerEntryModel.resource_pool == resource_pool
        pending = AgentSchedulerEntryModel.entry_status == "PENDING"
        claimed = AgentSchedulerEntryModel.entry_status == "CLAIMED"
        async with self._database.session() as session:
            queue_depth = int(await session.scalar(select(func.count()).select_from(AgentSchedulerEntryModel).where(pool, pending)) or 0)
            retry_depth = int(await session.scalar(select(func.count()).select_from(AgentSchedulerEntryModel).where(pool, pending, AgentSchedulerEntryModel.queue_kind == "RETRY")) or 0)
            oldest_at = await session.scalar(select(func.min(AgentSchedulerEntryModel.enqueued_at)).where(pool, pending))
            active_claims = int(await session.scalar(select(func.count()).select_from(AgentSchedulerEntryModel).where(pool, claimed, AgentSchedulerEntryModel.lease_until > captured_at)) or 0)
            expired_leases = int(await session.scalar(select(func.count()).select_from(AgentSchedulerEntryModel).where(pool, claimed, AgentSchedulerEntryModel.lease_until <= captured_at)) or 0)
            disagreements = int(await session.scalar(select(func.count()).select_from(AgentSchedulerEntryModel).where(pool, AgentSchedulerEntryModel.last_actual_rank.is_not(None), AgentSchedulerEntryModel.last_shadow_rank.is_not(None), AgentSchedulerEntryModel.last_actual_rank != AgentSchedulerEntryModel.last_shadow_rank)) or 0)
            open_circuits = int(await session.scalar(select(func.count()).select_from(AgentProviderCircuitModel).where(AgentProviderCircuitModel.state.in_(("OPEN", "HALF_OPEN")))) or 0)
            approved_releases = int(await session.scalar(select(func.count()).select_from(AgentRuntimeReleaseModel).where(AgentRuntimeReleaseModel.resource_pool == resource_pool, AgentRuntimeReleaseModel.status == "APPROVED")) or 0)
        oldest_age = 0.0 if oldest_at is None else max(0.0, (captured_at - oldest_at).total_seconds())
        return RuntimeOperationalSnapshot(resource_pool, captured_at, queue_depth, retry_depth, oldest_age, active_claims, expired_leases, disagreements, open_circuits, approved_releases)
