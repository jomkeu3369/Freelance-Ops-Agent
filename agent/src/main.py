"""FastAPI 애플리케이션 생성과 요청 의존성 연결."""

from fastapi import FastAPI

from api.agent_runs.router import router as agent_runs_router
from api.assumptions.router import router as assumptions_router
from api.health import router as health_router
from api.pets.router import router as pets_router
from api.platform.router import router as platform_router
from api.raptor.router import RaptorBuildService
from api.raptor.router import router as raptor_router
from api.task_commands.router import router as task_commands_router
from attachments.router import router as attachments_router
from config import get_settings
from infrastructure.readiness import DatabaseReadinessProbe
from observability import configure_langsmith_privacy, trace_context_middleware
from retrieval import OpenAIRaptorBuildService
from runtime import PostgresTaskCommandInbox, RunCoordinator
from runtime.bootstrap import RuntimeComponents, build_delegation_token_verifier, build_run_runtime
from runtime.lifespan import lifespan
from security import DelegationTokenVerifier


def create_app(*, run_coordinator: RunCoordinator | None = None, delegation_token_verifier: DelegationTokenVerifier | None = None, raptor_build_service: RaptorBuildService | None = None, task_command_inbox: PostgresTaskCommandInbox | None = None) -> FastAPI:  # noqa: E501
    settings = get_settings()
    configure_langsmith_privacy(enabled=settings.langsmith_tracing)
    app = FastAPI(
        title="Freelance Ops Agent AI Server",
        description="Freelance Ops Agent Server",
        version=settings.service_version,
        lifespan=lifespan
    )
    app.middleware("http")(trace_context_middleware)
    components = build_run_runtime() if run_coordinator is None else RuntimeComponents(coordinator=run_coordinator)
    app.state.run_coordinator = components.coordinator
    app.state.runtime_ready = False
    app.state.database_readiness_probe = DatabaseReadinessProbe()
    app.state.database_manager = components.database
    app.state.postgres_run_store = components.run_store
    app.state.checkpoint_journal = components.checkpoint
    app.state.async_runtime_services = components.services
    app.state.research_worker_sink = components.research_worker
    app.state.task_command_inbox = task_command_inbox or (
        components.services.task_command_inbox if components.services is not None else None
    )
    app.state.ai_gateway = components.model_gateway
    app.state.raptor_build_service = raptor_build_service or OpenAIRaptorBuildService()
    app.state.delegation_token_verifier = delegation_token_verifier or build_delegation_token_verifier()
    for router in (
        health_router,
        agent_runs_router,
        assumptions_router,
        pets_router,
        attachments_router,
        raptor_router,
        platform_router,
        task_commands_router,
    ):
        app.include_router(router)
    return app


app = create_app()
