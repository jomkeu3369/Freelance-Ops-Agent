"""펫 발화와 분리한 조사 계획·견적 심사 출력 계약."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from contracts import QuotationDraft


class QualityModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConversationResearchPlan(QualityModel):
    query: str | None = Field(max_length=240)
    reason: str = Field(min_length=1, max_length=500)


class RequirementCheck(QualityModel):
    requirement: str = Field(min_length=1, max_length=500)
    original_quote: str = Field(min_length=1, max_length=500)
    disposition: Literal["INCLUDED", "QUESTION", "EXCLUDED", "MISSING"]
    target: Literal["QUOTATION", "RESPONSE"] = "QUOTATION"
    item_indexes: list[int] = Field(max_length=50)
    rationale: str = Field(min_length=1, max_length=700)


class EffortCheck(QualityModel):
    item_index: int = Field(ge=0, le=49)
    verdict: Literal["PLAUSIBLE", "RETAINED", "UNJUSTIFIED", "IMPLAUSIBLE"]
    rationale: str = Field(min_length=1, max_length=1000)


class EvidenceCheck(QualityModel):
    source_id: str = Field(min_length=1, max_length=100)
    claim: str = Field(min_length=1, max_length=1000)
    supporting_quote: str = Field(default="", max_length=1000)
    supporting_quotes: list[Annotated[str, Field(min_length=1, max_length=1000)]] = Field(
        default_factory=list, max_length=5
    )
    supporting_passage_indexes: list[Annotated[int, Field(ge=0)]] = Field(default_factory=list, max_length=5)
    verdict: Literal["SUPPORTED", "UNSUPPORTED"]
    message_indexes: list[int] = Field(max_length=3)
    item_indexes: list[int] = Field(max_length=50)


class MessageCheck(QualityModel):
    message_index: int = Field(ge=0, le=2)
    verdict: Literal["GROUNDED", "ASSUMPTION", "UNSUPPORTED"]
    rationale: str = Field(min_length=1, max_length=1000)


class ConversationReview(QualityModel):
    summary: str = Field(min_length=1, max_length=1500)
    draft_disposition: Literal["APPROPRIATE", "DEFER_REQUIRED", "NOT_REQUESTED"] = "APPROPRIATE"
    requirements: list[RequirementCheck] = Field(min_length=1, max_length=50)
    effort_checks: list[EffortCheck] = Field(max_length=50)
    evidence_checks: list[EvidenceCheck] = Field(max_length=50)
    message_checks: list[MessageCheck] = Field(min_length=1, max_length=3)
    open_questions: list[str] = Field(max_length=3)


class MessageRevision(QualityModel):
    message_index: int = Field(ge=0, le=2)
    text: str = Field(min_length=1, max_length=5000)
    evidence_refs: list[str] = Field(max_length=10)


class ConversationRevision(QualityModel):
    messages: list[MessageRevision] = Field(max_length=3)
    draft: QuotationDraft | None
    open_questions: list[str] = Field(max_length=3)


QualityOperation = Literal["conversation_research_plan", "conversation_review", "conversation_revision"]
