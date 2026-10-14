"""Gemini API를 통한 구조화 생성."""

from __future__ import annotations

import logging
from typing import Any

from langsmith import traceable
from pydantic import BaseModel, ValidationError

from contracts import ModelSelection, PetProfile, Provider
from platform_budget import reject_unbounded_operation

from .contracts import (
    AssumptionSuggestion,
    DepartmentWorkProduct,
    ModelGeneration,
    ProviderCallError,
    ProviderNotConfiguredError,
    ReActStep,
)
from .prompts import (
    _ASSUMPTION_SYSTEM_INSTRUCTION,
    _PET_SYSTEM_INSTRUCTION,
    _REACT_SYSTEM_INSTRUCTION,
    _SYSTEM_INSTRUCTION,
)
from .retry import ResilientProvider
from .schema import strict_json_schema

logger = logging.getLogger(__name__)


class GeminiModelProvider(ResilientProvider):
    """공통 구조화 응답 계약을 사용하는 Google Gen AI 비동기 어댑터."""

    def __init__(self, client: Any | None = None, *, timeout_seconds: float = 60.0, max_attempts: int = 2) -> None:
        super().__init__(timeout_seconds=timeout_seconds, max_attempts=max_attempts)
        self._client = client

    async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._generate(
            selection,
            prompt,
            DepartmentWorkProduct,
            _SYSTEM_INSTRUCTION,
            max_output_tokens=max_output_tokens,
            max_attempts=max_attempts
        )

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._generate(
            selection,
            prompt,
            ReActStep,
            _REACT_SYSTEM_INSTRUCTION,
            max_output_tokens=max_output_tokens,
            max_attempts=max_attempts
        )

    async def generate_pet(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._generate(
            selection,
            prompt,
            PetProfile,
            _PET_SYSTEM_INSTRUCTION,
            max_output_tokens=max_output_tokens,
            max_attempts=max_attempts
        )

    async def generate_assumption(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._generate(
            selection,
            prompt,
            AssumptionSuggestion,
            _ASSUMPTION_SYSTEM_INSTRUCTION,
            max_output_tokens=max_output_tokens,
            max_attempts=max_attempts
        )

    @traceable(name="agent-gemini-model-call", run_type="llm", metadata={"component": "model-provider"})
    async def _generate(self, selection: ModelSelection, prompt: str, schema: type[BaseModel], system_instruction: str, *, max_output_tokens: int, max_attempts: int | None) -> ModelGeneration:  # noqa: E501
        reject_unbounded_operation("GEMINI")
        if selection.provider is not Provider.GEMINI:
            raise ProviderNotConfiguredError(f"provider is not configured: {selection.provider.value}")
        if self._client is None:
            from google import genai

            self._client = genai.Client().aio
        client: Any = self._client
        config = {
            "http_options": {"retry_options": {"attempts": 1}},
            "system_instruction": system_instruction,
            "response_mime_type": "application/json",
            "response_json_schema": strict_json_schema(schema.model_json_schema()),
            "max_output_tokens": max_output_tokens,
        }

        async def call() -> Any:
            return await client.models.generate_content(model=selection.model, contents=prompt, config=config)

        response, model_calls = await self._invoke(call, max_attempts)
        usage = getattr(response, "usage_metadata", None)
        input_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
        output_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)
        try:
            payload = schema.model_validate_json(str(response.text))
        except ValidationError:
            raise ProviderCallError(
                "model provider returned invalid structured output",
                model_calls=model_calls,
                input_tokens=input_tokens,
                output_tokens=output_tokens
            ) from None

        return ModelGeneration(
            payload=payload.model_dump(),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model_calls=model_calls
        )
