"""모델 생성의 공통 입출력과 오류 계약."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from contracts import ModelSelection, QuotationDraft


class DepartmentWorkProduct(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(max_length=10000)
    open_questions: list[str] = Field(default_factory=list, max_length=10)
    quotation_drafts: list[QuotationDraft] = Field(default_factory=list, max_length=3)


class AssumptionSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=3000)


class ReActArguments(BaseModel):
    """허용된 실행 도구에 전달할 인자 계약."""

    model_config = ConfigDict(extra="forbid")

    query: str | None = Field(default=None, min_length=1, max_length=2000)


class ReActStep(BaseModel):
    """제한된 ReAct 반복 한 단계의 응답 계약."""

    model_config = ConfigDict(extra="forbid")

    action: Literal["TOOL", "FINAL"]
    tool_name: str | None = Field(default=None, min_length=1, max_length=100)
    arguments: ReActArguments = Field(default_factory=lambda: ReActArguments())
    summary: str | None = Field(default=None, max_length=10000)
    open_questions: list[str] = Field(default_factory=list, max_length=10)
    quotation_drafts: list[QuotationDraft] = Field(default_factory=list, max_length=3)


@dataclass(frozen=True, slots=True)
class ModelGeneration:
    payload: dict[str, object]
    input_tokens: int = 0
    output_tokens: int = 0
    model_calls: int = 1


class ModelProvider(Protocol):
    async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration: ...  # noqa: E501

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration: ...  # noqa: E501

    async def generate_pet(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration: ...  # noqa: E501

    async def generate_pixel_pet(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration: ...  # noqa: E501

    async def generate_assumption(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration: ...  # noqa: E501


class ProviderNotConfiguredError(RuntimeError):
    """요청한 공급자가 설정되지 않았을 때 발생하는 오류."""


class ProviderCallError(RuntimeError):
    """요청 내용과 인증 정보를 제거한 모델 공급자 오류."""

    def __init__(self, message: str, *, model_calls: int = 0, input_tokens: int = 0, output_tokens: int = 0) -> None:
        super().__init__(message)
        self.model_calls = model_calls
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
