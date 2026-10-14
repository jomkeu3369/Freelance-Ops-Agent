"""선택한 공급자와 개인 키 클라이언트의 수명 관리."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from langsmith import tracing_context

from byok_budget import require_generation_scope
from config import get_settings
from contracts import ModelSelection, Provider
from personal_credentials import resolve_credential
from platform_budget import PlatformBudgetError

from .contracts import ModelGeneration, ModelProvider, ProviderCallError
from .gemini import GeminiModelProvider
from .openai import OpenAIModelProvider

logger = logging.getLogger(__name__)


class CompositeModelProvider:
    """각 실행을 명시적으로 선택한 공급자에 전달한다. 다른 공급자로 전환하지 않는다."""

    def __init__(self, openai: ModelProvider, gemini: ModelProvider) -> None:
        self._providers = {Provider.OPENAI: openai, Provider.GEMINI: gemini}

    @asynccontextmanager
    async def _selected_provider(self, selection: ModelSelection) -> AsyncIterator[ModelProvider]:
        personal_scope = require_generation_scope(selection)
        if personal_scope is not None:
            settings = get_settings()
            with tracing_context(enabled=False):
                yield OpenAIModelProvider(
                    timeout_seconds=settings.model_timeout_seconds,
                    max_attempts=settings.model_max_attempts,
                    credential_id=selection.credential_id
                )
            return
        if selection.credential_id is None:
            yield self._providers[selection.provider]
            return
        client: Any = None
        try:
            settings = get_settings()
            key = await resolve_credential(
                selection, settings.backend_internal_url, settings.backend_tool_timeout_seconds
            )
            provider: ModelProvider
            if selection.provider is Provider.OPENAI:
                from openai import AsyncOpenAI

                client = AsyncOpenAI(api_key=key, base_url="https://api.openai.com/v1", max_retries=0)
                provider = OpenAIModelProvider(
                    client,
                    timeout_seconds=settings.model_timeout_seconds,
                    max_attempts=settings.model_max_attempts,
                    credential_id=selection.credential_id
                )
            else:
                from google import genai

                client = genai.Client(api_key=key, vertexai=False).aio
                provider = GeminiModelProvider(
                    client, timeout_seconds=settings.model_timeout_seconds, max_attempts=settings.model_max_attempts
                )
            del key
            with tracing_context(enabled=False):
                yield provider
        except PlatformBudgetError:
            raise
        except ProviderCallError as error:
            raise ProviderCallError(
                "Personal AI connection call failed",
                model_calls=error.model_calls,
                input_tokens=error.input_tokens,
                output_tokens=error.output_tokens
            ) from None
        except Exception:
            raise ProviderCallError("Personal AI connection unavailable") from None
        finally:
            if client is not None:
                try:
                    if selection.provider is Provider.OPENAI:
                        await client.close()
                    else:
                        await client.aclose()
                except Exception:
                    logger.warning("Personal AI client cleanup failed")

    async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        async with self._selected_provider(selection) as provider:
            return await provider.generate_structured(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
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

    async def generate_assumption(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        async with self._selected_provider(selection) as provider:
            return await provider.generate_assumption(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )
