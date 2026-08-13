from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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


class DepartmentName(StrEnum):
    REQUIREMENTS = "REQUIREMENTS"
    RESEARCH = "RESEARCH"
    DEAL_DESIGN = "DEAL_DESIGN"
    VERIFICATION = "VERIFICATION"


class DirectToolOperation(StrEnum):
    """Spring이 명시적으로 허용한 결정적 Tool 작업입니다."""

    GET_PROJECT_CONTEXT = "GET_PROJECT_CONTEXT"


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


class ProjectContext(StrictModel):
    project_id: UUID
    workspace_id: UUID
    title: str = Field(max_length=200)
    requirement_text: str = Field(max_length=50000)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    deadline: str | None = None
    budget_min: float | None = Field(default=None, ge=0)
    budget_max: float | None = Field(default=None, ge=0)


class DomainPack(StrictModel):
    code: str = Field(min_length=2, max_length=64)
    version: str = Field(min_length=1, max_length=100)
    scope: str = Field(max_length=10000)
    required_fields: list[str] = Field(default_factory=list, max_length=100)
    question_templates: list[str] = Field(default_factory=list, max_length=100)


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


class AgentRunRequest(StrictModel):
    context: TrustedRunContext
    budget: RunBudget
    model_selection: ModelSelection
    safety_context: "SafetyContextInput"
    input: AgentInput


class HealthResponse(StrictModel):
    status: str
    service: str
    version: str


class DepartmentResult(StrictModel):
    department: DepartmentName
    status: str
    summary: str
    evidence_ids: list[UUID] = Field(default_factory=list)
    assumption_ids: list[UUID] = Field(default_factory=list)
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
    questions: list[str] = Field(min_length=1)


class AgentRunResult(StrictModel):
    project_summary: str = Field(max_length=10000)
    open_questions: list[str] = Field(default_factory=list)
    department_results: list[DepartmentResult] = Field(default_factory=list, max_length=4)


class AgentRunMetadata(StrictModel):
    provider: Provider
    model: str = Field(min_length=1, max_length=100)
    prompt_version: str = Field(min_length=1, max_length=100)
    tool_schema_version: str = Field(min_length=1, max_length=100)
    trace_id: str = Field(min_length=1, max_length=128)


class AgentRunView(StrictModel):
    run_id: UUID
    status: AgentRunStatus
    active_department: DepartmentName | None = None
    interruption: AgentInterruption | None = None
    result: AgentRunResult | None = None
    error_code: str | None = None
    metadata: AgentRunMetadata
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
