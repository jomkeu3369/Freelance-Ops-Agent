"""Composition helpers for the private route evaluator."""

from __future__ import annotations

from typing import Any

from config import Settings

from .llm_evaluator import (
    LLMRouteEvaluatorConfig,
    OpenAIRouteEvaluator,
    SecretSystemPrompt,
)


def build_openai_route_evaluator(
    settings: Settings,
    *,
    client: Any | None = None,
) -> OpenAIRouteEvaluator:
    """Build the evaluator only when the complete hash-pinned secret is present."""

    secret = settings.route_evaluator_system_prompt
    version = settings.route_evaluator_prompt_version
    expected_sha256 = settings.route_evaluator_prompt_sha256
    if secret is None or version is None or expected_sha256 is None:
        raise RuntimeError("private route evaluator prompt is not configured")

    if client is None:
        from openai import AsyncOpenAI

        client = AsyncOpenAI()

    prompt = SecretSystemPrompt(
        content=secret.get_secret_value(),
        version=version,
        expected_sha256=expected_sha256,
    )
    return OpenAIRouteEvaluator(
        client,
        prompt,
        config=LLMRouteEvaluatorConfig(
            model=settings.route_evaluator_model,
            reasoning_effort=settings.route_evaluator_reasoning_effort,
        ),
    )
