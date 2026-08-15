"""Dependency-free client for starting and inspecting bounded Agent runs."""

from __future__ import annotations

import json
import secrets
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID


class AIPlatformError(RuntimeError):
    """Sanitized platform error that does not expose authorization data."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(f"AI platform request failed: status={status} code={code}")
        self.status = status
        self.code = code


@dataclass(frozen=True, slots=True)
class TransportResponse:
    status: int
    body: bytes


class Transport(Protocol):
    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> TransportResponse: ...  # noqa: E501


class UrlLibTransport:
    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> TransportResponse:
        request = urllib.request.Request(url, data=body, headers=dict(headers), method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return TransportResponse(status=response.status, body=response.read())
        except urllib.error.HTTPError as error:
            return TransportResponse(status=error.code, body=error.read())


class AIPlatformClient:
    """Call the Spring-owned public API; never call the private Agent container directly."""

    def __init__(self, base_url: str, access_token: Callable[[], str], transport: Transport | None = None) -> None:
        if not base_url.startswith(("http://", "https://")):
            raise ValueError("base_url must use HTTP or HTTPS")
        self._base_url = base_url.rstrip("/")
        self._access_token = access_token
        self._transport = transport or UrlLibTransport()

    def start_run(self, workspace_id: UUID, project_id: UUID, payload: Mapping[str, object]) -> dict[str, object]:
        return self._json_request(
            "POST",
            f"/api/v2/workspaces/{workspace_id}/projects/{project_id}/agent-runs",
            payload
        )

    def get_run(self, workspace_id: UUID, run_id: UUID) -> dict[str, object]:
        return self._json_request("GET", f"/api/v2/workspaces/{workspace_id}/agent-runs/{run_id}", None)

    def cancel_run(self, workspace_id: UUID, run_id: UUID) -> dict[str, object]:
        return self._json_request("POST", f"/api/v2/workspaces/{workspace_id}/agent-runs/{run_id}/cancel", {})

    def _json_request(self, method: str, path: str, payload: Mapping[str, object] | None) -> dict[str, object]:
        token = self._access_token().strip()
        if not token:
            raise ValueError("access token provider returned an empty token")
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        response = self._transport.request(
            method,
            self._base_url + path,
            {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "traceparent": f"00-{secrets.token_hex(16)}-{secrets.token_hex(8)}-01"
            },
            body
        )
        decoded = json.loads(response.body.decode("utf-8")) if response.body else {}
        if not 200 <= response.status < 300:
            code = decoded.get("code") if isinstance(decoded, dict) else None
            raise AIPlatformError(response.status, str(code or "UNKNOWN"))
        if not isinstance(decoded, dict):
            raise AIPlatformError(502, "INVALID_RESPONSE")
        return decoded
