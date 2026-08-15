from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from tavily import AsyncTavilyClient  # type: ignore[import-untyped]

from api.agent_runs.router import router as agent_runs_router
from api.assumptions.router import router as assumptions_router
from api.platform.router import router as platform_router
from api.raptor.router import RaptorBuildService
from api.raptor.router import router as raptor_router
from config import Settings, get_settings
from contracts import HealthResponse
from gateway import AIGateway, GatewayPolicy
from infrastructure import PostgresCheckpointJournal
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from integrations import SpringToolClient
from observability import configure_langsmith_privacy, trace_context_middleware
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
from web_research import BoundedWebResearchService, DirectHttpProvider, TavilyWebResearchProvider, WebResearchRouter

RuntimeComponents = tuple[
    RunCoordinator,
    PgVectorConnectionManager | None,
    PostgresAgentRunStore | None,
    PostgresCheckpointJournal | None,
    AIGateway
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
        configure_langsmith_privacy(enabled=settings.langsmith_tracing)
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
        ai_gateway: AIGateway | None = None

        if run_coordinator is None:
            run_coordinator, database_manager, postgres_run_store, checkpoint_journal, ai_gateway = _build_run_runtime()

        self.app.state.run_coordinator = run_coordinator
        self.app.state.database_manager = database_manager
        self.app.state.postgres_run_store = postgres_run_store
        self.app.state.checkpoint_journal = checkpoint_journal
        self.app.state.ai_gateway = ai_gateway
        self.app.state.raptor_build_service = raptor_build_service or CompositeRaptorBuildService(OpenAIRaptorBuildService(), GeminiRaptorBuildService())  # noqa: E501
        self.app.state.delegation_token_verifier = (delegation_token_verifier or _build_delegation_token_verifier())
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
        self.app.include_router(assumptions_router)
        self.app.include_router(raptor_router)
        self.app.include_router(platform_router)

    def get_app(self) -> FastAPI:
        return self.app

def _build_run_runtime() -> RuntimeComponents:
    settings = get_settings()
    try:
        gateway: OperationalGateway = OperationalRouteGateway(build_openai_route_evaluator(settings))

    except RuntimeError:
        gateway = FailClosedOperationalGateway()

    model_gateway = AIGateway(
        CompositeModelProvider(
            OpenAIModelProvider(
                timeout_seconds=settings.model_timeout_seconds,
                max_attempts=settings.model_max_attempts
            ),
            GeminiModelProvider(
                timeout_seconds=settings.model_timeout_seconds,
                max_attempts=settings.model_max_attempts
            )
        ),
        policy=GatewayPolicy(
            max_concurrency=settings.gateway_max_concurrency,
            acquire_timeout_seconds=settings.gateway_acquire_timeout_seconds,
            circuit_failure_threshold=settings.gateway_circuit_failure_threshold,
            circuit_recovery_seconds=settings.gateway_circuit_recovery_seconds,
            allowed_models=settings.allowed_gateway_models()
        )
    )
    executor = OperationalAgentExecutor(
        gateway,
        model_gateway,
        SpringToolClient(
            settings.backend_internal_url,
            timeout_seconds=settings.backend_tool_timeout_seconds,
        ),
        _build_web_research_service(settings)
    )
    if settings.run_store_backend == "memory":
        return RunCoordinator(InMemoryAgentRunStore(), executor), None, None, None, model_gateway

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

    return RunCoordinator(store, executor, checkpoint), database, store, checkpoint, model_gateway

def _build_web_research_service(settings: Settings) -> BoundedWebResearchService | None:
    if not settings.web_research_enabled:
        return None

    api_key = settings.tavily_api_key
    key_value = api_key.get_secret_value() if api_key is not None else ""
    tavily = TavilyWebResearchProvider(AsyncTavilyClient(api_key=key_value))
    router = WebResearchRouter(tavily, DirectHttpProvider())

    return BoundedWebResearchService(
        router,
        settings.allowed_web_research_domains(),
        max_results=settings.web_research_max_results,
        max_fetches=settings.web_research_max_fetches,
        timeout_seconds=settings.web_research_timeout_seconds
    )

def _build_delegation_token_verifier() -> DelegationTokenVerifier:
    settings = get_settings()
    public_key = settings.delegation_token_public_key
    public_key_value = (
        public_key.get_secret_value().replace("\\n", "\n").strip()
        if public_key is not None
        else ""
    )

    previous_key = settings.delegation_token_previous_public_key
    previous_key_value = (
        previous_key.get_secret_value().replace("\\n", "\n").strip()
        if previous_key is not None
        else ""
    )

    previous_keys = (
        {settings.delegation_token_previous_key_id: previous_key_value}
        if settings.delegation_token_previous_key_id is not None and previous_key_value
        else {}
    )

    return DelegationTokenVerifier(
        public_key=public_key_value or "UNCONFIGURED",
        key_id=settings.delegation_token_key_id,
        previous_public_keys=previous_keys,
        issuer=settings.delegation_token_issuer,
        audience=settings.delegation_token_audience,
        algorithms=tuple(
            algorithm.strip()
            for algorithm in settings.delegation_token_algorithms.split(",")
            if algorithm.strip()
        ),
        leeway_seconds=settings.delegation_token_leeway_seconds
    )

def create_app(*, run_coordinator: RunCoordinator | None = None, delegation_token_verifier: DelegationTokenVerifier | None = None, raptor_build_service: RaptorBuildService | None = None) -> FastAPI:  # noqa: E501
    server = FreelanceOpsAgentAiServer(
        run_coordinator=run_coordinator,
        delegation_token_verifier=delegation_token_verifier,
        raptor_build_service=raptor_build_service
    )
    return server.get_app()


app = create_app()
