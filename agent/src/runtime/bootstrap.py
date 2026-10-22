"""설정에 따라 데이터베이스와 실행기, 외부 서비스를 구성한다."""

from dataclasses import dataclass

from tavily import AsyncTavilyClient  # type: ignore[import-untyped]

from config import Settings, get_settings
from gateway import AIGateway, GatewayPolicy
from infrastructure import PostgresCheckpointJournal
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from integrations import SpringTaskEventClient, SpringTaskRegistrationClient, SpringToolClient, TaskEventPublisher
from providers import OpenAIModelProvider, ScopedModelProvider
from retrieval.knowledge_context import KnowledgeContextLoader, OpenAIQueryEmbedder
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
    ReadOnlyResearchSpecialist,
    ResearchFifoDispatcherPilot,
    ResearchTaskWorker,
    ResearchWorkerDispatchSink,
    RunCoordinator,
    build_async_runtime_services,
)
from runtime.executor import ResearchTool
from security import DelegationTokenVerifier
from web_research import BoundedWebResearchService, DirectHttpProvider, TavilySearchProvider
from web_research.official_documentation import ConversationWebResearch, OfficialDocumentationResearch


@dataclass(frozen=True, slots=True)
class RuntimeComponents:
    coordinator: RunCoordinator
    database: PgVectorConnectionManager | None = None
    run_store: PostgresAgentRunStore | None = None
    checkpoint: PostgresCheckpointJournal | None = None
    model_gateway: AIGateway | None = None
    services: AsyncRuntimeServices | None = None
    research_worker: ResearchWorkerDispatchSink | None = None


def build_run_runtime() -> RuntimeComponents:
    settings = get_settings()
    try:
        gateway: OperationalGateway = build_operational_route_gateway(settings)

    except RuntimeError:
        gateway = FailClosedOperationalGateway()

    model_gateway = AIGateway(
        ScopedModelProvider(
            OpenAIModelProvider(
                timeout_seconds=settings.model_timeout_seconds, max_attempts=settings.model_max_attempts
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
    project_context_tool = SpringToolClient(
        settings.backend_internal_url, timeout_seconds=settings.backend_tool_timeout_seconds
    )
    research_tool = build_web_research_service(settings)
    conversation_research = build_conversation_research_service(settings)
    knowledge_loader = KnowledgeContextLoader(
        project_context_tool,
        OpenAIQueryEmbedder(settings.knowledge_embedding_model, settings.knowledge_embedding_timeout_seconds),
        settings.knowledge_embedding_model
    )
    if settings.run_store_backend == "memory":
        executor = OperationalAgentExecutor(
            gateway, model_gateway, project_context_tool, research_tool, knowledge_loader=knowledge_loader,
            conversation_research_tool=conversation_research
        )
        return RuntimeComponents(
            coordinator=RunCoordinator(InMemoryAgentRunStore(), executor, require_platform_budget=True),
            model_gateway=model_gateway
        )

    database = PgVectorConnectionManager(
        PgVectorPoolConfig(
            database_url=settings.database_url,
            min_size=settings.database_pool_min_size,
            max_size=settings.database_pool_max_size,
            timeout_seconds=settings.database_pool_timeout_seconds,
            open_timeout_seconds=settings.database_pool_open_timeout_seconds,
            max_lifetime_seconds=settings.database_pool_max_lifetime_seconds,
            max_idle_seconds=settings.database_pool_max_idle_seconds
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
        worker = ResearchTaskWorker(
            services.task_registry,
            ReadOnlyResearchSpecialist(model_gateway, research_tool),
            result_fence=PostgresResearchResultFence(services.task_registry)
        )
        research_worker_sink = ResearchWorkerDispatchSink(worker, context_broker, event_publisher)
        dispatcher = ResearchFifoDispatcherPilot(
            services.scheduler_store,
            research_worker_sink,
            resource_pool=settings.fifo_dispatcher_resource_pool,
            claimed_by=settings.fifo_dispatcher_claimed_by,
            lease_seconds=settings.fifo_dispatcher_lease_seconds,
            predicted_runtime_seconds=settings.fifo_dispatcher_predicted_runtime_seconds,
            predictor_version=settings.fifo_dispatcher_predictor_version,
            worker_count=settings.fifo_dispatcher_worker_count
        )
    task_shadow_registrar = (
        PostgresResearchTaskShadowRegistrar(
            services.task_registry,
            SpringTaskRegistrationClient(
                settings.backend_internal_url, timeout_seconds=settings.backend_tool_timeout_seconds
            ),
            event_publisher,
            dispatcher,
            context_broker,
            settings.allowed_fifo_dispatcher_workspaces() if dispatcher is not None else None
        )
        if settings.task_shadow_enabled
        else None
    )
    executor = OperationalAgentExecutor(
        gateway, model_gateway, project_context_tool, research_tool, task_shadow_registrar, knowledge_loader,
        conversation_research_tool=conversation_research
    )
    checkpoint = (
        PostgresCheckpointJournal(
            settings.database_url, open_timeout_seconds=settings.database_pool_open_timeout_seconds
        )
        if settings.checkpoint_backend == "postgres"
        else None
    )

    return RuntimeComponents(
        coordinator=RunCoordinator(store, executor, checkpoint, task_shadow_registrar, require_platform_budget=True),
        database=database,
        run_store=store,
        checkpoint=checkpoint,
        model_gateway=model_gateway,
        services=services,
        research_worker=research_worker_sink
    )


def build_conversation_research_service(settings: Settings) -> ResearchTool | None:
    paid = build_web_research_service(settings)
    official = OfficialDocumentationResearch() if settings.conversation_documentation_enabled else None
    return ConversationWebResearch(paid, official) if paid and official else paid or official


def build_web_research_service(settings: Settings) -> BoundedWebResearchService | None:
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


def build_delegation_token_verifier() -> DelegationTokenVerifier:
    settings = get_settings()
    public_key = settings.delegation_token_public_key
    public_key_value = public_key.get_secret_value().replace("\\n", "\n").strip() if public_key is not None else ""

    previous_key = settings.delegation_token_previous_public_key
    previous_key_value = (
        previous_key.get_secret_value().replace("\\n", "\n").strip() if previous_key is not None else ""
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
            algorithm.strip() for algorithm in settings.delegation_token_algorithms.split(",") if algorithm.strip()
        ),
        leeway_seconds=settings.delegation_token_leeway_seconds
    )
