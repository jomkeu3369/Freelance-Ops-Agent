"""Authenticated, content-free AI Gateway metrics."""

from __future__ import annotations

import hmac
from typing import Annotated, cast

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from config import get_settings
from gateway import AIGateway, GatewayMetricSnapshot

router = APIRouter(prefix="/internal/v1/platform", tags=["AIPlatform"])


@router.get("/metrics", response_model=None)
async def gateway_metrics(request: Request, authorization: Annotated[str | None, Header()] = None) -> PlainTextResponse | JSONResponse:  # noqa: E501
    settings = get_settings()
    configured = settings.gateway_metrics_bearer_token
    expected = configured.get_secret_value() if configured is not None else ""
    supplied = authorization.removeprefix("Bearer ") if authorization is not None else ""
    if not settings.gateway_metrics_enabled:
        return _problem(404, "Gateway metrics are disabled", "METRICS_DISABLED")
    if not expected or not hmac.compare_digest(supplied, expected):
        return _problem(401, "Metrics token is invalid", "METRICS_TOKEN_INVALID")

    gateway = cast(AIGateway | None, request.app.state.ai_gateway)
    if gateway is None:
        return _problem(503, "Gateway metrics are unavailable", "METRICS_UNAVAILABLE")
    return PlainTextResponse(_prometheus(gateway.telemetry.snapshot()), media_type="text/plain; version=0.0.4")


def _problem(status: int, title: str, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        media_type="application/problem+json",
        content={"title": title, "status": status, "code": code}
    )


def _prometheus(snapshot: GatewayMetricSnapshot) -> str:
    lines = [
        "# HELP ai_gateway_calls_total Model calls admitted by the gateway.",
        "# TYPE ai_gateway_calls_total counter",
        f'ai_gateway_calls_total{{outcome="success"}} {snapshot.successful_calls}',
        f'ai_gateway_calls_total{{outcome="failure"}} {snapshot.failed_calls}',
        f'ai_gateway_calls_total{{outcome="rejected"}} {snapshot.rejected_calls}',
        "# HELP ai_gateway_inflight_calls Current provider calls.",
        "# TYPE ai_gateway_inflight_calls gauge",
        f"ai_gateway_inflight_calls {snapshot.inflight_calls}",
        "# HELP ai_gateway_tokens_total Provider-reported token usage.",
        "# TYPE ai_gateway_tokens_total counter",
        f'ai_gateway_tokens_total{{type="input"}} {snapshot.input_tokens}',
        f'ai_gateway_tokens_total{{type="output"}} {snapshot.output_tokens}',
        "# HELP ai_gateway_latency_ms Recent in-process latency percentiles.",
        "# TYPE ai_gateway_latency_ms gauge",
        f'ai_gateway_latency_ms{{quantile="0.50"}} {snapshot.latency_ms_p50}',
        f'ai_gateway_latency_ms{{quantile="0.95"}} {snapshot.latency_ms_p95}'
    ]
    for code, count in sorted(snapshot.outcomes.items()):
        lines.append(f'ai_gateway_outcomes_total{{code="{code}"}} {count}')
    return "\n".join(lines) + "\n"
