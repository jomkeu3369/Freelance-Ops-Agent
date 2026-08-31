from __future__ import annotations

from typing import Any, cast

import pytest

from infrastructure.database.pgvector_connection import (
    DatabaseNotStartedError,
    PgVectorConnectionManager,
    PgVectorPoolConfig,
)


class FakeResult:
    def one_or_none(self) -> tuple[str, str, str, str]:
        return ("freelance_ops", "agent_user", "agent_runtime", "0.8.1")


class RuntimeTableResult:
    def __init__(self, values: tuple[str | None, ...]) -> None:
        self._values = values

    def one(self) -> tuple[str | None, ...]:
        return self._values


class FakeSession:
    def __init__(self) -> None:
        self.statements: list[object] = []
        self.commits = 0
        self.rollbacks = 0

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *args: object) -> None:
        del args

    async def execute(self, statement: object) -> FakeResult:
        self.statements.append(statement)
        return FakeResult()

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


class FakePool:
    def size(self) -> int:
        return 1

    def checkedin(self) -> int:
        return 1


class FakeEngine:
    def __init__(self) -> None:
        self.pool = FakePool()
        self.dispose_calls = 0

    async def dispose(self) -> None:
        self.dispose_calls += 1


def make_config() -> PgVectorPoolConfig:
    return PgVectorPoolConfig(
        database_url="postgresql://agent_user:secret@postgres:5432/freelance_ops",
        timeout_seconds=3.0,
        open_timeout_seconds=4.0,
    )


def test_config_hides_database_url_and_validates_pool_size() -> None:
    config = make_config()

    assert "secret" not in repr(config)
    with pytest.raises(ValueError, match="max_size"):
        PgVectorPoolConfig(database_url="postgresql://example", min_size=3, max_size=2)


def test_database_url_is_normalized_for_async_psycopg() -> None:
    assert PgVectorConnectionManager._sqlalchemy_url("postgresql://host/db") == "postgresql+psycopg://host/db"
    assert PgVectorConnectionManager._sqlalchemy_url("postgresql+psycopg://host/db") == "postgresql+psycopg://host/db"
    with pytest.raises(ValueError, match="postgresql"):
        PgVectorConnectionManager._sqlalchemy_url("sqlite:///local.db")


@pytest.mark.asyncio
async def test_session_requires_explicit_startup() -> None:
    manager = PgVectorConnectionManager(make_config())

    with pytest.raises(DatabaseNotStartedError):
        async with manager.session():
            pass


@pytest.mark.asyncio
async def test_health_uses_orm_statement_and_commits() -> None:
    manager = PgVectorConnectionManager(make_config())
    engine = FakeEngine()
    session = FakeSession()
    manager._engine = cast(Any, engine)
    manager._sessions = cast(Any, lambda: session)

    health = await manager.health()

    assert health.database == "freelance_ops"
    assert health.schema == "agent_runtime"
    assert health.vector_extension_version == "0.8.1"
    assert session.commits == 1
    assert session.statements
    assert "pg_extension" in str(session.statements[0])
    assert manager.stats() == {"size": 1, "checkedin": 1}

    await manager.close()
    assert engine.dispose_calls == 1


@pytest.mark.asyncio
async def test_runtime_table_verification_fails_closed_when_migration_is_missing() -> None:
    manager = PgVectorConnectionManager(make_config())
    engine = FakeEngine()
    session = FakeSession()

    async def execute(statement: object) -> RuntimeTableResult:
        session.statements.append(statement)
        return RuntimeTableResult(("agent_run_state", "agent_run_event", "agent_task", None, "agent_task_event"))

    session.execute = cast(Any, execute)
    manager._engine = cast(Any, engine)
    manager._sessions = cast(Any, lambda: session)

    with pytest.raises(RuntimeError, match="agent_task_attempt"):
        await manager.verify_runtime_tables()
