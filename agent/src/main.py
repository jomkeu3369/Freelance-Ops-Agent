from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from tavily import AsyncTavilyClient  # type: ignore[import-untyped]

from api.agent_runs.router import router as agent_runs_router
from api.assumptions.router import router as assumptions_router
from api.platform.router import router as platform_router
from api.raptor.router import RaptorBuildService
from api.raptor.router import router as raptor_router
from api.task_commands.router import router as task_commands_router
from config import Settings, get_settings
from contracts import HealthResponse
from gateway import AIGateway, GatewayPolicy
from infrastructure import PostgresCheckpointJournal
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from integrations import SpringTaskEventClient, SpringTaskRegistrationClient, SpringToolClient, TaskEventPublisher
from observability import configure_langsmith_privacy, trace_context_middleware
from providers import CompositeModelProvider, GeminiModelProvider, OpenAIModelProvider
from retrieval import CompositeRaptorBuildService, GeminiRaptorBuildService, OpenAIRaptorBuildService
from routing import build_operational_route_gateway
from runtime import (
    AsyncRuntimeServices,
    FailClosedOperationalGateway,
    InMemoryAgentRunStore,
    InMemoryResearchDispatchContextBroker,
    OperationalAgentExecutor,
    OperationalGateway,
    PostgresAgentRunStore,
    PostgresResearchResultFence,
    PostgresResearchTaskShadowRegistrar,
    PostgresTaskCommandInbox,
    ReadOnlyResearchSpecialist,
    ResearchFifoDispatcherPilot,
    ResearchTaskWorker,
    ResearchWorkerDispatchSink,
    RunCoordinator,
    build_async_runtime_services,
)
from security import DelegationTokenVerifier
from web_research import BoundedWebResearchService, DirectHttpProvider, TavilySearchProvider

RuntimeComponents = tuple[
    RunCoordinator,
    PgVectorConnectionManager | None,
    PostgresAgentRunStore | None,
    PostgresCheckpointJournal | None,
    AIGateway,
    AsyncRuntimeServices | None,
    ResearchWorkerDispatchSink | None
]


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
        yield

    finally:
        if research_worker_sink is not None:
            await research_worker_sink.wait()

        if checkpoint is not None:
            await checkpoint.close()

        if database is not None:
            await database.close()


class FreelanceOpsAgentAiServer:
    def __init__(self, *, run_coordinator: RunCoordinator | None = None, delegation_token_verifier: DelegationTokenVerifier | None = None, raptor_build_service: RaptorBuildService | None = None, task_command_inbox: PostgresTaskCommandInbox | None = None) -> None:  # noqa: E501
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
        async_runtime_services: AsyncRuntimeServices | None = None
        research_worker_sink: ResearchWorkerDispatchSink | None = None

        if run_coordinator is None:
            run_coordinator, database_manager, postgres_run_store, checkpoint_journal, ai_gateway, async_runtime_services, research_worker_sink = _build_run_runtime()  # noqa: E501

        self.app.state.run_coordinator = run_coordinator
        self.app.state.database_manager = database_manager
        self.app.state.postgres_run_store = postgres_run_store
        self.app.state.checkpoint_journal = checkpoint_journal
        self.app.state.async_runtime_services = async_runtime_services
        self.app.state.research_worker_sink = research_worker_sink
        self.app.state.task_command_inbox = task_command_inbox or (
            async_runtime_services.task_command_inbox if async_runtime_services is not None else None
        )
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
        self.app.include_router(task_commands_router)

    def get_app(self) -> FastAPI:
        return self.app

def _build_run_runtime() -> RuntimeComponents:
    settings = get_settings()
    try:
        gateway: OperationalGateway = build_operational_route_gateway(settings)

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
    project_context_tool = SpringToolClient(settings.backend_internal_url, timeout_seconds=settings.backend_tool_timeout_seconds)  # noqa: E501
    research_tool = _build_web_research_service(settings)
    if settings.run_store_backend == "memory":
        executor = OperationalAgentExecutor(gateway, model_gateway, project_context_tool, research_tool)
        return RunCoordinator(InMemoryAgentRunStore(), executor), None, None, None, model_gateway, None, None

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
    services = build_async_runtime_services(database)
    event_publisher = TaskEventPublisher(
        services.task_event_store,
        SpringTaskEventClient(settings.backend_internal_url, timeout_seconds=settings.backend_tool_timeout_seconds)
    )
    research_worker_sink: ResearchWorkerDispatchSink | None = None
    dispatcher: ResearchFifoDispatcherPilot | None = None
    context_broker: InMemoryResearchDispatchContextBroker | None = None
    if settings.fifo_dispatcher_enabled:
        if research_tool is None:
            raise RuntimeError("enabled FIFO dispatcher requires the Research tool")
        context_broker = InMemoryResearchDispatchContextBroker()
        worker = ResearchTaskWorker(services.task_registry, ReadOnlyResearchSpecialist(model_gateway, research_tool), result_fence=PostgresResearchResultFence(services.task_registry))  # noqa: E501
        research_worker_sink = ResearchWorkerDispatchSink(worker, context_broker, event_publisher)
        dispatcher = ResearchFifoDispatcherPilot(services.scheduler_store, research_worker_sink, resource_pool=settings.fifo_dispatcher_resource_pool, claimed_by=settings.fifo_dispatcher_claimed_by, lease_seconds=settings.fifo_dispatcher_lease_seconds, predicted_runtime_seconds=settings.fifo_dispatcher_predicted_runtime_seconds, predictor_version=settings.fifo_dispatcher_predictor_version, worker_count=settings.fifo_dispatcher_worker_count)  # noqa: E501
    task_shadow_registrar = (
        PostgresResearchTaskShadowRegistrar(
            services.task_registry,
            SpringTaskRegistrationClient(settings.backend_internal_url, timeout_seconds=settings.backend_tool_timeout_seconds),  # noqa: E501
            event_publisher,
            dispatcher,
            context_broker,
            settings.allowed_fifo_dispatcher_workspaces() if dispatcher is not None else None
        )
        if settings.task_shadow_enabled
        else None
    )
    executor = OperationalAgentExecutor(gateway, model_gateway, project_context_tool, research_tool, task_shadow_registrar)  # noqa: E501
    checkpoint = (
        PostgresCheckpointJournal(
            settings.database_url,
            open_timeout_seconds=settings.database_pool_open_timeout_seconds,
        )
        if settings.checkpoint_backend == "postgres"
        else None
    )

    return RunCoordinator(store, executor, checkpoint, task_shadow_registrar), database, store, checkpoint, model_gateway, services, research_worker_sink  # noqa: E501

def _build_web_research_service(settings: Settings) -> BoundedWebResearchService | None:
    if not settings.web_research_enabled:
        return None

    api_key = settings.tavily_api_key
    key_value = api_key.get_secret_value() if api_key is not None else ""
    tavily = TavilySearchProvider(AsyncTavilyClient(api_key=key_value))

    return BoundedWebResearchService(
        tavily,
        DirectHttpProvider(),
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

def create_app(*, run_coordinator: RunCoordinator | None = None, delegation_token_verifier: DelegationTokenVerifier | None = None, raptor_build_service: RaptorBuildService | None = None, task_command_inbox: PostgresTaskCommandInbox | None = None) -> FastAPI:  # noqa: E501
    server = FreelanceOpsAgentAiServer(
        run_coordinator=run_coordinator,
        delegation_token_verifier=delegation_token_verifier,
        raptor_build_service=raptor_build_service,
        task_command_inbox=task_command_inbox
    )
    return server.get_app()


app = create_app()
