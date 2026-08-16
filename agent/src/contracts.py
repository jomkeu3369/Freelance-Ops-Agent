from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MAX_INTERRUPTION_QUESTIONS = 3


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        alias_generator=lambda name: "".join(
            word if index == 0 else word.capitalize()
            for index, word in enumerate(name.split("_"))
        ),
        populate_by_name=True,
    )


class Provider(StrEnum):
    OPENAI = "OPENAI"
    GEMINI = "GEMINI"


class ReasoningEffort(StrEnum):
    NONE = "NONE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class RequestTier(StrEnum):
    DIRECT_TOOL = "DIRECT_TOOL"
    SINGLE_AGENT = "SINGLE_AGENT"
    DEPARTMENT = "DEPARTMENT"
    MULTI_DEPARTMENT = "MULTI_DEPARTMENT"
    HUMAN_REQUIRED = "HUMAN_REQUIRED"


class DepartmentName(StrEnum):
    REQUIREMENTS = "REQUIREMENTS"
    RESEARCH = "RESEARCH"
    DEAL_DESIGN = "DEAL_DESIGN"
    VERIFICATION = "VERIFICATION"


class DirectToolOperation(StrEnum):
    """Spring이 명시적으로 허용한 결정적 Tool 작업입니다."""

    GET_PROJECT_CONTEXT = "GET_PROJECT_CONTEXT"


class AgentWorkflowMode(StrEnum):
    PROJECT_ANALYSIS = "PROJECT_ANALYSIS"
    AD_HOC = "AD_HOC"


class TrustedRunContext(StrictModel):
    run_id: UUID
    thread_id: UUID
    trace_id: str = Field(min_length=1, max_length=128)
    workspace_id: UUID
    project_id: UUID
    initiated_by: UUID
    effective_permissions: list[str]


class RunBudget(StrictModel):
    max_duration_seconds: int = Field(ge=1, le=900)
    max_model_calls: int = Field(ge=0, le=50)
    max_tool_calls: int = Field(ge=0, le=100)
    max_input_tokens: int = Field(ge=0)
    max_output_tokens: int = Field(ge=0)
    max_departments: int = Field(ge=1, le=4)
    max_hierarchy_depth: int = Field(ge=1, le=2)
    max_search_credits: int = Field(default=0, ge=0, le=100)
    max_retries: int = Field(default=1, ge=0, le=5)
    max_handoffs: int = Field(default=3, ge=0, le=10)


class ModelSelection(StrictModel):
    provider: Provider
    model: str = Field(min_length=1, max_length=100)
    reasoning_effort: ReasoningEffort = ReasoningEffort.LOW


class AgentInput(StrictModel):
    requirement_text: str = Field(min_length=1, max_length=50000)
    locale: str = "ko-KR"
    jurisdiction_code: str | None = Field(default=None, min_length=2, max_length=32)
    direct_tool_operation: DirectToolOperation | None = None
    workflow_mode: AgentWorkflowMode = AgentWorkflowMode.PROJECT_ANALYSIS


class AssumptionSuggestionRequest(StrictModel):
    context: TrustedRunContext
    model_selection: ModelSelection
    project_requirement: str = Field(min_length=1, max_length=50000)
    item_title: str = Field(min_length=1, max_length=200)
    item_description: str = Field(default="", max_length=5000)
    quantity: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=20)
    current_assumption: str = Field(default="", max_length=3000)


class AssumptionSuggestionUsage(StrictModel):
    model_calls: int = Field(ge=0)
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    retry_count: int = Field(ge=0)
    duration_ms: int = Field(ge=0)


class AssumptionSuggestionResponse(StrictModel):
    run_id: UUID
    content: str = Field(min_length=1, max_length=3000)
    provider: Provider
    model: str = Field(min_length=1, max_length=100)
    usage: AssumptionSuggestionUsage


class ProjectContext(StrictModel):
    project_id: UUID
    workspace_id: UUID
    title: str = Field(max_length=200)
    requirement_text: str = Field(max_length=50000)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    deadline: str | None = None
    budget_min: float | None = Field(default=None, ge=0)
    budget_max: float | None = Field(default=None, ge=0)


class DomainPackSourceReference(StrictModel):
    title: str = Field(min_length=1, max_length=500)
    url: str = Field(min_length=1, max_length=2048)


class DomainPack(StrictModel):
    code: str = Field(min_length=2, max_length=64)
    version: str = Field(min_length=1, max_length=100)
    jurisdiction_code: str = Field(min_length=2, max_length=32)
    profession_code: str = Field(min_length=2, max_length=64)
    scope: str = Field(max_length=10000)
    required_fields: list[str] = Field(default_factory=list, max_length=100)
    question_templates: list[str] = Field(default_factory=list, max_length=100)
    source_references: list[DomainPackSourceReference] = Field(default_factory=list, max_length=100)
    effective_from: str
    effective_until: str | None = None


class RequirementDraft(StrictModel):
    project_id: UUID
    summary: str = Field(max_length=10000)
    features: list[str] = Field(default_factory=list, max_length=200)
    constraints: list[str] = Field(default_factory=list, max_length=200)
    assumptions: list[str] = Field(default_factory=list, max_length=200)
    open_questions: list[str] = Field(default_factory=list, max_length=100)


class RequirementValidationResult(StrictModel):
    valid: bool
    errors: list[str] = Field(default_factory=list, max_length=200)
    warnings: list[str] = Field(default_factory=list, max_length=200)


class QuoteCalculationItem(StrictModel):
    item_id: UUID
    quantity: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class QuoteCalculationRequest(StrictModel):
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    tax_rate: float = Field(ge=0, le=1)
    discount_rate: float = Field(ge=0, le=1)
    items: list[QuoteCalculationItem] = Field(min_length=1, max_length=500)


class QuoteCalculationResult(StrictModel):
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    subtotal: float
    discount_amount: float
    tax_amount: float
    total: float
    formula_version: str = Field(min_length=1, max_length=100)


class KnowledgeSearchRequest(StrictModel):
    query: str = Field(min_length=1, max_length=2000)
    embedding: list[float] | None = Field(default=None, min_length=1536, max_length=1536)
    limit: int = Field(default=10, ge=1, le=50)


class KnowledgeSearchResult(StrictModel):
    chunk_id: UUID
    document_id: UUID
    document_title: str = Field(max_length=300)
    source_type: str
    source_uri: str | None = None
    source_version: str | None = None
    jurisdiction: str | None = None
    effective_from: str | None = None
    effective_until: str | None = None
    content: str = Field(max_length=20000)
    rrf_score: float
    keyword_rank: int = Field(ge=0)
    vector_rank: int | None = Field(default=None, ge=1)


class ClarificationAnswer(StrictModel):
    question: str = Field(min_length=1, max_length=5000)
    answer: str = Field(min_length=1, max_length=5000)


class AgentRunRequest(StrictModel):
    context: TrustedRunContext
    budget: RunBudget
    model_selection: ModelSelection
    safety_context: "SafetyContextInput"
    input: AgentInput
    clarification_history: list[ClarificationAnswer] = Field(default_factory=list, max_length=30)


class HealthResponse(StrictModel):
    status: str
    service: str
    version: str


class SourceReference(StrictModel):
    title: str = Field(max_length=500)
    url: str = Field(min_length=1, max_length=2048)
    provider: str = Field(min_length=1, max_length=50)
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    fetched_at: datetime
    authority_level: str = Field(min_length=1, max_length=50)
    jurisdiction: str | None = Field(default=None, max_length=32)
    excerpt: str = Field(min_length=1, max_length=4000)


class DepartmentResult(StrictModel):
    department: DepartmentName
    status: str
    summary: str
    evidence_ids: list[UUID] = Field(default_factory=list)
    assumption_ids: list[UUID] = Field(default_factory=list)
    sources: list[SourceReference] = Field(default_factory=list, max_length=10)
    error_code: str | None = None


class SafetyContextInput(StrictModel):
    external_side_effect: bool = False
    sensitive_data: bool = False
    financial_authority_required: bool = False
    legal_authority_required: bool = False
    irreversible_action: bool = False
    approval_required: bool = False
    authority_verified: bool = False


class AgentRunStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    WAITING_FOR_USER = "WAITING_FOR_USER"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class InterruptionKind(StrEnum):
    CLARIFICATION = "CLARIFICATION"
    RISK_DECISION = "RISK_DECISION"
    QUOTE_APPROVAL = "QUOTE_APPROVAL"


class AgentRunAccepted(StrictModel):
    run_id: UUID
    status: AgentRunStatus
    accepted_at: datetime


class AgentInterruption(StrictModel):
    interruption_id: UUID
    kind: InterruptionKind
    questions: list[str] = Field(min_length=1, max_length=MAX_INTERRUPTION_QUESTIONS)


class DraftWorkUnit(StrEnum):
    HOUR = "HOUR"
    DAY = "DAY"
    FIXED = "FIXED"


class DraftBasisType(StrEnum):
    ASSUMPTION = "ASSUMPTION"
    EVIDENCE = "EVIDENCE"


class QuotationDraftBasis(StrictModel):
    type: DraftBasisType
    content: str = Field(min_length=1, max_length=3000)
    source_reference: str | None = Field(default=None, max_length=2048)
    source_title: str | None = Field(default=None, max_length=300)


class QuotationDraftItem(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    quantity: float = Field(gt=0)
    unit: DraftWorkUnit
    rate_card_hint: str | None = Field(default=None, max_length=200)
    basis: QuotationDraftBasis


class QuotationDraft(StrictModel):
    scenario: str = Field(default="RECOMMENDED", pattern=r"^(LEAN|RECOMMENDED|EXPANDED)$")
    items: list[QuotationDraftItem] = Field(min_length=1, max_length=50)


class AgentRunResult(StrictModel):
    project_summary: str = Field(max_length=10000)
    open_questions: list[str] = Field(default_factory=list)
    department_results: list[DepartmentResult] = Field(default_factory=list, max_length=4)
    quotation_draft: QuotationDraft | None = None
    quotation_drafts: list[QuotationDraft] = Field(default_factory=list, max_length=3)


class AgentRunMetadata(StrictModel):
    provider: Provider
    model: str = Field(min_length=1, max_length=100)
    prompt_version: str = Field(min_length=1, max_length=100)
    tool_schema_version: str = Field(min_length=1, max_length=100)
    trace_id: str = Field(min_length=1, max_length=128)


class AgentRunUsage(StrictModel):
    request_tier: RequestTier
    model_calls: int = Field(ge=0)
    tool_calls: int = Field(ge=0)
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    cached_tokens: int = Field(default=0, ge=0)
    search_credits: int = Field(default=0, ge=0)
    crawled_pages: int = Field(default=0, ge=0)
    retry_count: int = Field(default=0, ge=0)
    duration_ms: int = Field(ge=0)


class AgentRunView(StrictModel):
    run_id: UUID
    status: AgentRunStatus
    active_department: DepartmentName | None = None
    interruption: AgentInterruption | None = None
    result: AgentRunResult | None = None
    error_code: str | None = None
    metadata: AgentRunMetadata
    usage: AgentRunUsage | None = None
    updated_at: datetime


class AgentRunEvent(StrictModel):
    event_id: int = Field(ge=1)
    run_id: UUID
    type: str = Field(pattern=r"^[a-z]+(?:\.[a-z]+)+$", max_length=100)
    occurred_at: datetime
    data: dict[str, object] = Field(default_factory=dict)


class ResumeAnswer(StrictModel):
    question_index: int = Field(ge=0)
    answer: str = Field(min_length=1, max_length=5000)


class ResumeAgentRunRequest(StrictModel):
    interruption_id: UUID
    idempotency_key: str = Field(min_length=8, max_length=128)
    answers: list[ResumeAnswer] = Field(min_length=1)


class RaptorBuildContext(StrictModel):
    run_id: UUID
    workspace_id: UUID
    project_id: UUID
    snapshot_id: UUID


class RaptorSourceChunkInput(StrictModel):
    chunk_id: UUID
    document_id: UUID
    text: str = Field(min_length=1, max_length=20000)
    metadata: dict[str, str] = Field(default_factory=dict)


class RaptorBuildOptions(StrictModel):
    target_cluster_size: int = Field(default=4, ge=2, le=50)
    max_summary_levels: int = Field(default=4, ge=1, le=8)
    kmeans_iterations: int = Field(default=20, ge=1, le=100)


class RaptorBuildRequest(StrictModel):
    context: RaptorBuildContext
    provider: Provider = Provider.OPENAI
    embedding_model: str = Field(min_length=1, max_length=100)
    summary_model: str = Field(min_length=1, max_length=100)
    chunks: list[RaptorSourceChunkInput] = Field(min_length=1, max_length=500)
    options: RaptorBuildOptions = Field(default_factory=RaptorBuildOptions)


class RaptorNodeOutput(StrictModel):
    node_id: UUID
    kind: str
    level: int
    text: str
    embedding: list[float]
    child_ids: list[UUID] = Field(default_factory=list)
    source_chunk_id: UUID | None = None
    document_id: UUID | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class RaptorBuildResponse(StrictModel):
    workspace_id: UUID
    snapshot_id: UUID
    embedding_model: str
    summary_model: str
    nodes: list[RaptorNodeOutput]
    root_ids: list[UUID]
