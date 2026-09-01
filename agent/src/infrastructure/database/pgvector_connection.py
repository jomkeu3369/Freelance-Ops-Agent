"""SQLAlchemy async connection manager for PostgreSQL and pgvector."""

# ruff: noqa: E501, I001

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import cast

from sqlalchemy import Table, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .models import AgentRunEventModel, AgentRunStateModel, AgentRuntimeBase, AgentTaskAttemptModel, AgentTaskCommandReceiptModel, AgentTaskEventModel, AgentTaskModel, PgExtensionModel

REQUIRED_RUNTIME_TABLES = (
    "agent_runtime.agent_run_state",
    "agent_runtime.agent_run_event",
    "agent_runtime.agent_task",
    "agent_runtime.agent_task_attempt",
    "agent_runtime.agent_task_event",
    "agent_runtime.agent_task_command_receipt",
    "agent_runtime.agent_retry_bucket",
    "agent_runtime.agent_provider_circuit"
)


class DatabaseNotStartedError(RuntimeError):
    """Raised when a database operation is attempted before startup."""


@dataclass(frozen=True, slots=True)
class PgVectorPoolConfig:
    """Connection settings that keep credentials out of repr output."""

    database_url: str = field(repr=False)
    min_size: int = 1
    max_size: int = 5
    timeout_seconds: float = 10.0
    open_timeout_seconds: float = 10.0
    max_lifetime_seconds: float = 1800.0
    max_idle_seconds: float = 300.0
    application_name: str = "freelance-ops-agent"

    def __post_init__(self) -> None:
        if not self.database_url.strip():
            raise ValueError("database_url must not be empty")
        if self.min_size < 1:
            raise ValueError("min_size must be at least 1")
        if self.max_size < self.min_size:
            raise ValueError("max_size must be greater than or equal to min_size")
        for name, value in (
            ("timeout_seconds", self.timeout_seconds),
            ("open_timeout_seconds", self.open_timeout_seconds),
            ("max_lifetime_seconds", self.max_lifetime_seconds),
            ("max_idle_seconds", self.max_idle_seconds),
        ):
            if value <= 0:
                raise ValueError(f"{name} must be positive")


@dataclass(frozen=True, slots=True)
class PgVectorHealth:
    database: str
    role: str
    schema: str
    vector_extension_version: str


class PgVectorConnectionManager:
    """Own one async engine and create one transaction-scoped session per task."""

    def __init__(self, config: PgVectorPoolConfig) -> None:
        self._config = config
        self._engine: AsyncEngine | None = None
        self._sessions: async_sessionmaker[AsyncSession] | None = None

    @property
    def is_open(self) -> bool:
        return self._engine is not None and self._sessions is not None

    async def open(self) -> None:
        if self.is_open:
            return
        engine = self._create_engine()
        self._engine = engine
        self._sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            await asyncio.wait_for(self.health(), timeout=self._config.open_timeout_seconds)
        except BaseException:
            self._engine = None
            self._sessions = None
            await engine.dispose()
            raise

    async def close(self) -> None:
        engine, self._engine, self._sessions = self._engine, None, None
        if engine is not None:
            await engine.dispose()

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        factory = self._require_sessions()
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    async def create_runtime_tables(self) -> None:
        engine = self._require_engine()
        # 테스트 전용 호환 경로다. 운영 startup은 Alembic migration 후 verify_runtime_tables를 사용한다.
        async with engine.begin() as connection:
            await connection.run_sync(
                AgentRuntimeBase.metadata.create_all,
                tables=[cast(Table, AgentRunStateModel.__table__), cast(Table, AgentRunEventModel.__table__), cast(Table, AgentTaskModel.__table__), cast(Table, AgentTaskAttemptModel.__table__), cast(Table, AgentTaskEventModel.__table__), cast(Table, AgentTaskCommandReceiptModel.__table__)]  # noqa: E501
            )

    async def verify_runtime_tables(self) -> None:
        statement = select(*(func.to_regclass(table_name) for table_name in REQUIRED_RUNTIME_TABLES))
        async with self.session() as session:
            row = (await session.execute(statement)).one()
        missing = [table_name for table_name, resolved in zip(REQUIRED_RUNTIME_TABLES, row, strict=True) if resolved is None]
        if missing:
            raise RuntimeError(f"Agent runtime migrations are incomplete: {', '.join(missing)}")

    async def health(self) -> PgVectorHealth:
        statement = (
            select(
                func.current_database(),
                func.current_user(),
                func.current_schema(),
                PgExtensionModel.extversion,
            )
            .where(PgExtensionModel.extname == "vector")
            .limit(1)
        )
        async with self.session() as session:
            row = (await session.execute(statement)).one_or_none()
        if row is None:
            raise RuntimeError("PostgreSQL extension 'vector' is not installed")
        return PgVectorHealth(
            database=str(row[0]),
            role=str(row[1]),
            schema=str(row[2]),
            vector_extension_version=str(row[3]),
        )

    def stats(self) -> Mapping[str, int]:
        pool = self._require_engine().pool
        values: dict[str, int] = {}
        for name in ("size", "checkedin", "checkedout", "overflow"):
            method = getattr(pool, name, None)
            if callable(method):
                values[name] = int(method())
        return values

    def _create_engine(self) -> AsyncEngine:
        return create_async_engine(
            self._sqlalchemy_url(self._config.database_url),
            pool_size=self._config.min_size,
            max_overflow=self._config.max_size - self._config.min_size,
            pool_timeout=self._config.timeout_seconds,
            pool_recycle=int(self._config.max_lifetime_seconds),
            connect_args={
                "application_name": self._config.application_name,
                "options": "-c search_path=agent_runtime,public",
            },
        )

    def _require_engine(self) -> AsyncEngine:
        if self._engine is None:
            raise DatabaseNotStartedError("PostgreSQL engine is not open")
        return self._engine

    def _require_sessions(self) -> async_sessionmaker[AsyncSession]:
        if self._sessions is None:
            raise DatabaseNotStartedError("PostgreSQL engine is not open")
        return self._sessions

    @staticmethod
    def _sqlalchemy_url(database_url: str) -> str:
        if database_url.startswith("postgresql+psycopg://"):
            return database_url
        if database_url.startswith("postgresql://"):
            return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        raise ValueError("database_url must use postgresql:// or postgresql+psycopg://")
