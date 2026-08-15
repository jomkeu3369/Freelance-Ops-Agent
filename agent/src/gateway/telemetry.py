"""Content-free operational metrics for model gateway calls."""

from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass
from threading import Lock


@dataclass(frozen=True, slots=True)
class GatewayMetricSnapshot:
    total_calls: int
    successful_calls: int
    failed_calls: int
    rejected_calls: int
    inflight_calls: int
    input_tokens: int
    output_tokens: int
    latency_ms_p50: float
    latency_ms_p95: float
    outcomes: dict[str, int]


class GatewayTelemetry:
    """Bounded in-memory metrics without prompts, responses, or credentials."""

    def __init__(self, sample_limit: int = 2048) -> None:
        if sample_limit < 1:
            raise ValueError("gateway telemetry sample_limit must be positive")
        self._lock = Lock()
        self._latencies_ms: deque[float] = deque(maxlen=sample_limit)
        self._outcomes: Counter[str] = Counter()
        self._total_calls = 0
        self._successful_calls = 0
        self._failed_calls = 0
        self._rejected_calls = 0
        self._inflight_calls = 0
        self._input_tokens = 0
        self._output_tokens = 0

    def started(self) -> None:
        with self._lock:
            self._total_calls += 1
            self._inflight_calls += 1

    def succeeded(self, *, latency_ms: float, input_tokens: int, output_tokens: int) -> None:
        with self._lock:
            self._successful_calls += 1
            self._inflight_calls -= 1
            self._latencies_ms.append(latency_ms)
            self._input_tokens += input_tokens
            self._output_tokens += output_tokens
            self._outcomes["SUCCESS"] += 1

    def failed(self, *, latency_ms: float, code: str) -> None:
        with self._lock:
            self._failed_calls += 1
            self._inflight_calls -= 1
            self._latencies_ms.append(latency_ms)
            self._outcomes[code] += 1

    def rejected(self, *, code: str) -> None:
        with self._lock:
            self._rejected_calls += 1
            self._outcomes[code] += 1

    def snapshot(self) -> GatewayMetricSnapshot:
        with self._lock:
            latencies = sorted(self._latencies_ms)
            return GatewayMetricSnapshot(
                total_calls=self._total_calls,
                successful_calls=self._successful_calls,
                failed_calls=self._failed_calls,
                rejected_calls=self._rejected_calls,
                inflight_calls=self._inflight_calls,
                input_tokens=self._input_tokens,
                output_tokens=self._output_tokens,
                latency_ms_p50=_percentile(latencies, 0.50),
                latency_ms_p95=_percentile(latencies, 0.95),
                outcomes=dict(self._outcomes)
            )


def _percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    index = min(len(values) - 1, max(0, int((len(values) - 1) * quantile)))
    return round(values[index], 3)
