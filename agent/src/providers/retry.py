"""시간 초과와 일시적인 통신 오류의 재시도 정책."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from platform_budget import PlatformBudgetError

from .contracts import ProviderCallError

logger = logging.getLogger(__name__)


class ResilientProvider:
    def __init__(self, *, timeout_seconds: float = 60.0, max_attempts: int = 2) -> None:
        if timeout_seconds <= 0 or not 1 <= max_attempts <= 3:
            raise ValueError("model provider retry configuration is invalid")
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max_attempts

    async def _invoke(self, operation: Callable[[], Awaitable[Any]], max_attempts: int | None = None) -> tuple[Any, int]:  # noqa: E501
        attempt_limit = min(self._max_attempts, max_attempts) if max_attempts is not None else self._max_attempts
        if attempt_limit < 1:
            raise ValueError("model provider max_attempts must be positive")

        for attempt in range(1, attempt_limit + 1):
            try:
                return await asyncio.wait_for(operation(), timeout=self._timeout_seconds), attempt
            except PlatformBudgetError:
                raise
            except Exception as error:
                if attempt >= attempt_limit or not self._retryable(error):
                    logger.warning(
                        "Model provider call failed: error_type=%s status_code=%s",
                        error.__class__.__name__,
                        getattr(error, "status_code", None)
                    )
                    raise ProviderCallError("model provider call failed") from error
                await asyncio.sleep(0.1 * attempt)

        raise AssertionError("unreachable provider retry state")

    @staticmethod
    def _retryable(error: Exception) -> bool:
        if isinstance(error, TimeoutError):
            return True

        status_code = getattr(error, "status_code", None)
        return isinstance(status_code, int) and (status_code == 429 or status_code >= 500)
