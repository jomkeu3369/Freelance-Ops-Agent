"""Minimal W3C trace-context propagation for the internal Agent API."""

from __future__ import annotations

import re
import secrets
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

TRACEPARENT = re.compile(
    r"^(?P<version>[0-9a-f]{2})-(?P<trace_id>[0-9a-f]{32})-(?P<parent_id>[0-9a-f]{16})-(?P<flags>[0-9a-f]{2})$"
)


async def trace_context_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    incoming = request.headers.get("traceparent", "").lower()
    match = TRACEPARENT.fullmatch(incoming)
    trace_id = (
        match.group("trace_id")
        if match is not None and match.group("trace_id") != "0" * 32
        else secrets.token_hex(16)
    )
    
    flags = match.group("flags") if match is not None else "01"
    request.state.traceparent = f"00-{trace_id}-{secrets.token_hex(8)}-{flags}"
    request.state.trace_id = trace_id
    response = await call_next(request)
    
    # 서비스마다 새 span id를 발급하되 동일 trace id를 유지
    response.headers["traceparent"] = f"00-{trace_id}-{secrets.token_hex(8)}-{flags}"
    response.headers["X-Trace-Id"] = trace_id
    return response
