"""플랫폼 생성과 승인된 개인 키 실행의 공급자를 연결한다."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from langsmith import tracing_context

from byok_budget import require_generation_scope
from config import get_settings
from contracts import ModelSelection, Provider
from platform_budget import PlatformBudgetError

from .contracts import ModelGeneration, ModelProvider, ProviderNotConfiguredError
from .conversation_quality import QualityOperation
from .openai import OpenAIModelProvider


class ScopedModelProvider:
    """플랫폼 공급자와 개인 키의 승인 범위를 분리한다."""

    def __init__(self, platform: ModelProvider) -> None:
        self._platform = platform

    @asynccontextmanager
    async def _selected_provider(self, selection: ModelSelection) -> AsyncIterator[ModelProvider]:
        if selection.provider is not Provider.OPENAI:
            raise ProviderNotConfiguredError(f"provider is no longer supported: {selection.provider.value}")
        personal_scope = require_generation_scope(selection)
        if personal_scope is None:
            if selection.credential_id is not None:
                raise PlatformBudgetError("BYOK_BUDGET_REQUIRED")
            yield self._platform
            return
        settings = get_settings()
        with tracing_context(enabled=False):
            yield OpenAIModelProvider(
                timeout_seconds=settings.model_timeout_seconds,
                max_attempts=settings.model_max_attempts,
                credential_id=selection.credential_id
            )

    async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        async with self._selected_provider(selection) as provider:
            return await provider.generate_structured(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )

    async def generate_conversation_quality(self, selection: ModelSelection, prompt: str, *, operation: QualityOperation, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        async with self._selected_provider(selection) as provider:
            return await provider.generate_conversation_quality(
                selection, prompt, operation=operation, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        async with self._selected_provider(selection) as provider:
            return await provider.generate_react_step(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )

    async def generate_pet(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        async with self._selected_provider(selection) as provider:
            return await provider.generate_pet(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )

    async def generate_pixel_pet(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        async with self._selected_provider(selection) as provider:
            return await provider.generate_pixel_pet(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )

    async def generate_assumption(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        async with self._selected_provider(selection) as provider:
            return await provider.generate_assumption(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )
