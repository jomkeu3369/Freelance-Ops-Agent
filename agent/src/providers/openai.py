"""OpenAI 구조화 생성과 개인 키 실행 계획의 예산 사전 점검."""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID

from langsmith import traceable
from pydantic import BaseModel, ValidationError

from byok_budget import byok_openai_attempt, current_byok_ledger, require_generation_scope
from contracts import ModelSelection, PetProfile, Provider
from platform_budget import PlatformBudgetError, budgeted_openai_attempt

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
from .schema import compact_prompt_and_schema, strict_json_schema

logger = logging.getLogger(__name__)


def openai_generation_payload(selection: ModelSelection, prompt: str, schema: type[BaseModel], schema_name: str, system_instruction: str, max_output_tokens: int) -> dict[str, Any]:  # noqa: E501
    output_schema = strict_json_schema(schema.model_json_schema())
    prompt, output_schema = compact_prompt_and_schema(prompt, output_schema)
    return dict(
        model=selection.model,
        service_tier="default",
        reasoning={"effort": selection.reasoning_effort.value.lower()},
        input=[{"role": "system", "content": system_instruction}, {"role": "user", "content": prompt}],
        tools=[],
        store=False,
        max_output_tokens=max_output_tokens,
        text={
            "verbosity": "low",
            "format": {"type": "json_schema", "name": schema_name, "strict": True, "schema": output_schema},
        }
    )


def preflight_byok_react_plan(selection: ModelSelection, prompts: list[str], output_limit: int) -> None:
    """공급자 호출 예산을 예약하기 전에 최소 부서 실행 계획을 검사한다."""
    ledger = current_byok_ledger()
    if ledger is None:
        raise PlatformBudgetError("BYOK_BUDGET_REQUIRED")
    ledger.validate(selection)
    payloads = [
        openai_generation_payload(
            selection,
            prompt,
            ReActStep,
            "bounded_react_step",
            _REACT_SYSTEM_INSTRUCTION,
            ledger.output_limit(output_limit)
        )
        for prompt in prompts
    ]
    ledger.preflight(payloads)


class OpenAIModelProvider(ResilientProvider):
    """구조화된 JSON을 요청하고 응답 저장을 끄는 OpenAI Responses 어댑터."""

    def __init__(self, client: Any | None = None, *, timeout_seconds: float = 60.0, max_attempts: int = 2, credential_id: UUID | None = None) -> None:  # noqa: E501
        super().__init__(timeout_seconds=timeout_seconds, max_attempts=max_attempts)
        self._client = client
        self._credential_id = credential_id

    async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._generate(
            selection,
            prompt,
            DepartmentWorkProduct,
            "department_work_product",
            _SYSTEM_INSTRUCTION,
            max_output_tokens=max_output_tokens,
            max_attempts=max_attempts
        )

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._generate(
            selection,
            prompt,
            ReActStep,
            "bounded_react_step",
            _REACT_SYSTEM_INSTRUCTION,
            max_output_tokens=max_output_tokens,
            max_attempts=max_attempts
        )

    async def generate_pet(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._generate(
            selection,
            prompt,
            PetProfile,
            "pet_profile",
            _PET_SYSTEM_INSTRUCTION,
            max_output_tokens=max_output_tokens,
            max_attempts=max_attempts
        )

    async def generate_assumption(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._generate(
            selection,
            prompt,
            AssumptionSuggestion,
            "quotation_assumption",
            _ASSUMPTION_SYSTEM_INSTRUCTION,
            max_output_tokens=max_output_tokens,
            max_attempts=max_attempts
        )

    @traceable(name="agent-openai-model-call", run_type="llm", metadata={"component": "model-provider"})
    async def _generate(self, selection: ModelSelection, prompt: str, schema: type[BaseModel], schema_name: str, system_instruction: str, *, max_output_tokens: int, max_attempts: int | None) -> ModelGeneration:  # noqa: E501
        personal_scope = require_generation_scope(selection)
        if personal_scope is not None and (self._client is not None or self._credential_id != selection.credential_id):
            raise PlatformBudgetError("BYOK_AMBIENT_CLIENT_FORBIDDEN")
        if selection.provider is not Provider.OPENAI:
            raise ProviderNotConfiguredError(f"provider is not configured: {selection.provider.value}")

        if self._client is None and personal_scope is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(base_url="https://api.openai.com/v1", max_retries=0)

        client: Any = self._client

        async def call() -> Any:
            payload = openai_generation_payload(
                selection,
                prompt,
                schema,
                schema_name,
                system_instruction,
                max_output_tokens
            )
            if personal_scope is not None:
                return await byok_openai_attempt(selection, schema_name, payload)
            return await budgeted_openai_attempt(
                client, selection, schema_name, payload, client_credential_id=self._credential_id
            )

        attempt_limit = min(self._max_attempts, max_attempts) if max_attempts is not None else self._max_attempts
        if attempt_limit < 1:
            raise ValueError("model provider max_attempts must be positive")
        model_calls = 0
        input_tokens = 0
        output_tokens = 0
        while model_calls < attempt_limit:
            response, call_attempts = await self._invoke(call, attempt_limit - model_calls)
            model_calls += call_attempts
            usage = getattr(response, "usage", None)
            input_tokens += int(getattr(usage, "input_tokens", 0) or 0)
            output_tokens += int(getattr(usage, "output_tokens", 0) or 0)
            if getattr(response, "status", "completed") != "completed":
                incomplete_details = getattr(response, "incomplete_details", None)
                logger.warning(
                    "OpenAI model response was incomplete: reason=%s", getattr(incomplete_details, "reason", None)
                )
                raise ProviderCallError(
                    "model provider returned incomplete output",
                    model_calls=model_calls,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens
                ) from None
            try:
                payload = schema.model_validate_json(str(response.output_text))
            except ValidationError:
                if model_calls >= attempt_limit:
                    logger.warning("OpenAI model response did not satisfy the structured output contract")
                    raise ProviderCallError(
                        "model provider returned invalid structured output",
                        model_calls=model_calls,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens
                    ) from None
                logger.warning("OpenAI model response was invalid; retrying structured generation")
                await asyncio.sleep(0.1 * model_calls)
                continue

            return ModelGeneration(
                payload=payload.model_dump(),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                model_calls=model_calls
            )

        raise AssertionError("unreachable structured generation retry state")
