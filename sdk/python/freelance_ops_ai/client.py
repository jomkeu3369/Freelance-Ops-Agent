"""Spring 공개 API를 통한 Agent 실행 시작·조회·취소."""

from __future__ import annotations

import json
import secrets
from collections.abc import Callable, Mapping
from uuid import UUID

from .errors import AIPlatformError
from .transport import Transport, TransportResponse, UrlLibTransport

# 기존 client 모듈에서 가져오던 이름도 계속 제공한다.
__all__ = ["AIPlatformClient", "AIPlatformError", "Transport", "TransportResponse", "UrlLibTransport"]


class AIPlatformClient:
    """인증 토큰을 받아 Spring이 소유한 공개 API를 호출한다."""

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
        try:
            decoded = json.loads(response.body.decode("utf-8")) if response.body else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            decoded = None
        if not 200 <= response.status < 300:
            code = decoded.get("code") if isinstance(decoded, dict) else None
            raise AIPlatformError(response.status, str(code or "UNKNOWN"))
        if not isinstance(decoded, dict):
            raise AIPlatformError(502, "INVALID_RESPONSE")
        return decoded
