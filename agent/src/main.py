from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.agent_runs.router import router as agent_runs_router
from api.raptor.router import RaptorBuildService
from api.raptor.router import router as raptor_router
from config import get_settings
from contracts import HealthResponse
from infrastructure import PostgresCheckpointJournal
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from integrations import SpringToolClient
from observability import trace_context_middleware
from providers import CompositeModelProvider, GeminiModelProvider, OpenAIModelProvider
from retrieval import CompositeRaptorBuildService, GeminiRaptorBuildService, OpenAIRaptorBuildService
from routing import OperationalRouteGateway
from routing.wiring import build_openai_route_evaluator
from runtime import (
    FailClosedOperationalGateway,
    InMemoryAgentRunStore,
    OperationalAgentExecutor,
    OperationalGateway,
    PostgresAgentRunStore,
    RunCoordinator,
)
from security import DelegationTokenVerifier

RuntimeComponents = tuple[
    RunCoordinator,
    PgVectorConnectionManager | None,
    PostgresAgentRunStore | None,
    PostgresCheckpointJournal | None
]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    database: PgVectorConnectionManager | None = app.state.database_manager
    store: PostgresAgentRunStore | None = app.state.postgres_run_store
    checkpoint: PostgresCheckpointJournal | None = app.state.checkpoint_journal
    
    try:
        if database is not None and store is not None:
            await database.open()
            await store.initialize()
        
        if checkpoint is not None:
            await checkpoint.open()
        yield
    
    finally:
        if checkpoint is not None:
            await checkpoint.close()
        
        if database is not None:
            await database.close()


class FreelanceOpsAgentAiServer:
    def __init__(self, *, run_coordinator: RunCoordinator | None = None, delegation_token_verifier: DelegationTokenVerifier | None = None, raptor_build_service: RaptorBuildService | None = None) -> None:  # noqa: E501
        settings = get_settings()
        self.app = FastAPI(
            title="Freelance Ops Agent AI Server",
            description="Freelance Ops Agent Server",
            version=settings.service_version,
            lifespan=lifespan,
            # docs_url=None,
            # redoc_url=None
        )
        
        self.app.middleware("http")(trace_context_middleware)
        database_manager: PgVectorConnectionManager | None = None
        postgres_run_store: PostgresAgentRunStore | None = None
        checkpoint_journal: PostgresCheckpointJournal | None = None
        
        if run_coordinator is None:
            run_coordinator, database_manager, postgres_run_store, checkpoint_journal = _build_run_runtime()
        
        self.app.state.run_coordinator = run_coordinator
        self.app.state.database_manager = database_manager
        self.app.state.postgres_run_store = postgres_run_store
        self.app.state.checkpoint_journal = checkpoint_journal
        self.app.state.raptor_build_service = raptor_build_service or CompositeRaptorBuildService(
            OpenAIRaptorBuildService(),
            GeminiRaptorBuildService(),
        )
        self.app.state.delegation_token_verifier = (
            delegation_token_verifier or _build_delegation_token_verifier()
        )
        self._register_routes()

    def _register_routes(self) -> None:
        @self.app.get("/version", tags=["root"])
        async def get_version() -> dict[str, str]:
            return {"version": get_settings().service_version}

        @self.app.get("/health", response_model=HealthResponse)
        async def health_check() -> HealthResponse:
            settings = get_settings()
            return HealthResponse(status="UP", service=settings.service_name, version=settings.service_version)

        self.app.include_router(agent_runs_router)
        self.app.include_router(raptor_router)

    def get_app(self) -> FastAPI:
        return self.app


def _build_run_runtime() -> RuntimeComponents:
    settings = get_settings()
    try:
        gateway: OperationalGateway = OperationalRouteGateway(build_openai_route_evaluator(settings))
    
    except RuntimeError:
        gateway = FailClosedOperationalGateway()
    
    executor = OperationalAgentExecutor(
        gateway,
        CompositeModelProvider(
            OpenAIModelProvider(
                timeout_seconds=settings.model_timeout_seconds,
                max_attempts=settings.model_max_attempts,
            ),
            GeminiModelProvider(
                timeout_seconds=settings.model_timeout_seconds,
                max_attempts=settings.model_max_attempts,
            ),
        ),
        SpringToolClient(
            settings.backend_internal_url,
            timeout_seconds=settings.backend_tool_timeout_seconds,
        )
    )
    if settings.run_store_backend == "memory":
        return RunCoordinator(InMemoryAgentRunStore(), executor), None, None, None
    
    database = PgVectorConnectionManager(
        PgVectorPoolConfig(
            database_url=settings.database_url,
            min_size=settings.database_pool_min_size,
            max_size=settings.database_pool_max_size,
            timeout_seconds=settings.database_pool_timeout_seconds,
            open_timeout_seconds=settings.database_pool_open_timeout_seconds,
            max_lifetime_seconds=settings.database_pool_max_lifetime_seconds,
            max_idle_seconds=settings.database_pool_max_idle_seconds,
        )
    )
    
    store = PostgresAgentRunStore(database)
    checkpoint = (
        PostgresCheckpointJournal(
            settings.database_url,
            open_timeout_seconds=settings.database_pool_open_timeout_seconds,
        )
        if settings.checkpoint_backend == "postgres"
        else None
    )
    
    return RunCoordinator(store, executor, checkpoint), database, store, checkpoint


def _build_delegation_token_verifier() -> DelegationTokenVerifier:
    settings = get_settings()
    public_key = settings.delegation_token_public_key
    public_key_value = (
        public_key.get_secret_value().replace("\\n", "\n").strip()
        if public_key is not None
        else ""
    )
    return DelegationTokenVerifier(
        public_key=public_key_value or "UNCONFIGURED",
        issuer=settings.delegation_token_issuer,
        audience=settings.delegation_token_audience,
        algorithms=tuple(
            algorithm.strip()
            for algorithm in settings.delegation_token_algorithms.split(",")
            if algorithm.strip()
        ),
        leeway_seconds=settings.delegation_token_leeway_seconds,
    )


def create_app(*, run_coordinator: RunCoordinator | None = None, delegation_token_verifier: DelegationTokenVerifier | None = None, raptor_build_service: RaptorBuildService | None = None) -> FastAPI:  # noqa: E501
    server = FreelanceOpsAgentAiServer(
        run_coordinator=run_coordinator,
        delegation_token_verifier=delegation_token_verifier,
        raptor_build_service=raptor_build_service,
    )
    return server.get_app()

app = create_app()
