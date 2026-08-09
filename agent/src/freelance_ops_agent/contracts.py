from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Provider(StrEnum):
    OPENAI = "OPENAI"
    GEMINI = "GEMINI"


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


class ModelSelection(StrictModel):
    provider: Provider
    model: str = Field(min_length=1, max_length=100)
    reasoning_effort: str = "LOW"


class AgentInput(StrictModel):
    requirement_text: str = Field(min_length=1, max_length=50000)
    locale: str = "ko-KR"
    jurisdiction_code: str | None = Field(default=None, min_length=2, max_length=32)


class AgentRunRequest(StrictModel):
    context: TrustedRunContext
    budget: RunBudget
    model_selection: ModelSelection
    request_tier: RequestTier
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

