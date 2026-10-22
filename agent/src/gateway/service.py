"""모델 어댑터에 공통 접근 정책을 적용한다."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from contracts import ModelSelection
from platform_budget import PlatformBudgetError, validate_reasoning
from providers import ModelGeneration, ModelProvider, ProviderCallError
from providers.conversation_quality import QualityOperation

from .telemetry import GatewayTelemetry

logger = logging.getLogger(__name__)


class GatewayRejectedError(ProviderCallError):
    """플랫폼 정책이 모델 호출을 거부했을 때 발생하는 오류."""


@dataclass(frozen=True, slots=True)
class GatewayPolicy:
    max_concurrency: int = 2
    acquire_timeout_seconds: float = 2.0
    circuit_failure_threshold: int = 3
    circuit_recovery_seconds: float = 30.0
    allowed_models: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if self.max_concurrency < 1:
            raise ValueError("gateway max_concurrency must be positive")
        if self.acquire_timeout_seconds <= 0:
            raise ValueError("gateway acquire timeout must be positive")
        if self.circuit_failure_threshold < 1:
            raise ValueError("gateway circuit threshold must be positive")
        if self.circuit_recovery_seconds <= 0:
            raise ValueError("gateway circuit recovery must be positive")


@dataclass(slots=True)
class _CircuitState:
    consecutive_failures: int = 0
    opened_at: float | None = None


class AIGateway:
    """호출 승인, 모델 허용 목록, 회로 차단기와 관측 정책을 적용한다. 실행은 Spring이
    기록한 공급자와 모델을 사용하며 다른 공급자로 전환하지 않는다.
    """

    def __init__(self, provider: ModelProvider, *, policy: GatewayPolicy, telemetry: GatewayTelemetry | None = None) -> None:  # noqa: E501
        self._provider = provider
        self._policy = policy
        self._telemetry = telemetry or GatewayTelemetry()
        self._semaphore = asyncio.Semaphore(policy.max_concurrency)
        self._circuits: dict[str, _CircuitState] = {}
        self._circuit_lock = asyncio.Lock()

    @property
    def telemetry(self) -> GatewayTelemetry:
        return self._telemetry

    async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._call(
            "structured_generation",
            selection,
            lambda: self._provider.generate_structured(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )
        )

    async def generate_conversation_quality(self, selection: ModelSelection, prompt: str, *, operation: QualityOperation, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._call(operation, selection, lambda: self._provider.generate_conversation_quality(
            selection, prompt, operation=operation, max_output_tokens=max_output_tokens, max_attempts=max_attempts
        ))

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._call(
            "react_step",
            selection,
            lambda: self._provider.generate_react_step(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )
        )

    async def generate_pet(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._call(
            "pet_profile",
            selection,
            lambda: self._provider.generate_pet(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )
        )

    async def generate_pixel_pet(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._call(
            "pixel_pet_profile",
            selection,
            lambda: self._provider.generate_pixel_pet(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )
        )

    async def generate_assumption(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self._call(
            "quotation_assumption",
            selection,
            lambda: self._provider.generate_assumption(
                selection, prompt, max_output_tokens=max_output_tokens, max_attempts=max_attempts
            )
        )

    async def _call(self, operation: str, selection: ModelSelection, invoke: Callable[[], Awaitable[ModelGeneration]]) -> ModelGeneration:  # noqa: E501
        self._require_allowed_model(selection)
        circuit_key = f"{selection.provider.value}:{selection.model}"
        if selection.credential_id is None:
            await self._require_closed_circuit(circuit_key)
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=self._policy.acquire_timeout_seconds)
        except TimeoutError as error:
            self._telemetry.rejected(code="GATEWAY_CAPACITY_EXCEEDED")
            raise GatewayRejectedError("AI gateway capacity is exhausted") from error

        self._telemetry.started()
        started = time.monotonic()
        try:
            generation = await invoke()
        except asyncio.CancelledError:
            latency_ms = (time.monotonic() - started) * 1000
            self._telemetry.failed(latency_ms=latency_ms, code="CALL_CANCELLED")
            raise
        except PlatformBudgetError as error:
            # 사용자의 예약 소진이나 잘못된 예약은 공급자 장애로 처리하지 않는다.
            # 공유 회로 차단기 상태는 유지하고 시작한 호출 지표만 정리한다.
            latency_ms = (time.monotonic() - started) * 1000
            self._telemetry.rejected(code=error.code, latency_ms=latency_ms)
            raise
        except Exception:
            latency_ms = (time.monotonic() - started) * 1000
            if selection.credential_id is None:
                await self._record_failure(circuit_key)
            self._telemetry.failed(latency_ms=latency_ms, code="PROVIDER_FAILURE")
            logger.warning(
                "AI gateway call failed: operation=%s provider=%s model=%s",
                operation,
                selection.provider.value,
                selection.model
            )
            raise
        else:
            latency_ms = (time.monotonic() - started) * 1000
            if selection.credential_id is None:
                await self._record_success(circuit_key)
            self._telemetry.succeeded(
                latency_ms=latency_ms, input_tokens=generation.input_tokens, output_tokens=generation.output_tokens
            )
            logger.info(
                "AI gateway call completed: operation=%s provider=%s model=%s "
                "latency_ms=%.3f input_tokens=%d output_tokens=%d",
                operation,
                selection.provider.value,
                selection.model,
                latency_ms,
                generation.input_tokens,
                generation.output_tokens
            )
            return generation
        finally:
            self._semaphore.release()

    def _require_allowed_model(self, selection: ModelSelection) -> None:
        validate_reasoning(selection)
        if self._policy.allowed_models and selection.model not in self._policy.allowed_models:
            self._telemetry.rejected(code="MODEL_NOT_ALLOWED")
            raise GatewayRejectedError("selected model is not allowed by AI gateway policy")

    async def _require_closed_circuit(self, key: str) -> None:
        async with self._circuit_lock:
            state = self._circuits.setdefault(key, _CircuitState())
            if state.opened_at is None:
                return
            if time.monotonic() - state.opened_at >= self._policy.circuit_recovery_seconds:
                state.opened_at = None
                state.consecutive_failures = 0
                return
        self._telemetry.rejected(code="CIRCUIT_OPEN")
        raise GatewayRejectedError("AI gateway circuit is open")

    async def _record_failure(self, key: str) -> None:
        async with self._circuit_lock:
            state = self._circuits.setdefault(key, _CircuitState())
            state.consecutive_failures += 1
            if state.consecutive_failures >= self._policy.circuit_failure_threshold:
                state.opened_at = time.monotonic()

    async def _record_success(self, key: str) -> None:
        async with self._circuit_lock:
            state = self._circuits.setdefault(key, _CircuitState())
            state.consecutive_failures = 0
            state.opened_at = None
