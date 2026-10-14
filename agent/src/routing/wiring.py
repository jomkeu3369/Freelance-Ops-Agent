"""비공개 경로 평가자의 구성 함수."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from config import Settings

from .llm_evaluator import LLMRouteEvaluatorConfig, OpenAIRouteEvaluator, OperationalRouteGateway, SecretSystemPrompt

logger = logging.getLogger(__name__)


def build_openai_route_evaluator(settings: Settings, *, client: Any | None = None) -> OpenAIRouteEvaluator:
    """프롬프트 원문과 승인된 해시가 모두 있을 때 평가자를 구성한다."""

    secret = settings.route_evaluator_system_prompt
    version = settings.route_evaluator_prompt_version
    expected_sha256 = settings.route_evaluator_prompt_sha256
    if secret is None or version is None or expected_sha256 is None:
        raise RuntimeError("private route evaluator prompt is not configured")

    prompt = SecretSystemPrompt(content=secret.get_secret_value(), version=version, expected_sha256=expected_sha256)
    return OpenAIRouteEvaluator(
        client,
        prompt,
        config=LLMRouteEvaluatorConfig(
            model=settings.route_evaluator_model, reasoning_effort=settings.route_evaluator_reasoning_effort
        )
    )


def build_operational_route_gateway(settings: Settings, *, client: Any | None = None, shadow_model_provider: Callable[[], Any] | None = None) -> OperationalRouteGateway:  # noqa: E501
    evaluator = build_openai_route_evaluator(settings, client=client)
    shadow_model = None
    if settings.route_shadow_enabled:
        provider = shadow_model_provider
        if provider is None:
            from graph.router import build_local_route_model

            provider = build_local_route_model
        try:
            shadow_model = provider()
        except (ImportError, OSError, RuntimeError, ValueError) as error:
            logger.warning("Local route shadow is unavailable: error_type=%s", error.__class__.__name__)
    return OperationalRouteGateway(evaluator, shadow_model=shadow_model)
