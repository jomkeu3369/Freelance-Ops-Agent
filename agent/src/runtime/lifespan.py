"""데이터베이스와 실행 서비스의 시작·종료 순서."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from infrastructure import PostgresCheckpointJournal
from infrastructure.database import PgVectorConnectionManager
from runtime import AsyncRuntimeServices, PostgresAgentRunStore, ResearchWorkerDispatchSink


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    database: PgVectorConnectionManager | None = app.state.database_manager
    store: PostgresAgentRunStore | None = app.state.postgres_run_store
    checkpoint: PostgresCheckpointJournal | None = app.state.checkpoint_journal
    async_runtime_services: AsyncRuntimeServices | None = app.state.async_runtime_services
    research_worker_sink: ResearchWorkerDispatchSink | None = app.state.research_worker_sink

    try:
        if database is not None and store is not None:
            await database.open()
            await store.initialize()

        if async_runtime_services is not None:
            await async_runtime_services.task_registry.initialize()
            await async_runtime_services.task_event_store.initialize()

        if checkpoint is not None:
            await checkpoint.open()
        app.state.runtime_ready = True
        yield

    finally:
        app.state.runtime_ready = False
        await app.state.database_readiness_probe.close()
        if research_worker_sink is not None:
            await research_worker_sink.wait()

        if checkpoint is not None:
            await checkpoint.close()

        if database is not None:
            await database.close()
