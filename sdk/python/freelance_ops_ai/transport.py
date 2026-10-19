"""표준 라이브러리 HTTP 전송과 대체 전송 구현의 인터페이스."""

from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class TransportResponse:
    status: int
    body: bytes


class Transport(Protocol):
    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> TransportResponse: ...


class UrlLibTransport:
    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> TransportResponse:
        request = urllib.request.Request(url, data=body, headers=dict(headers), method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return TransportResponse(status=response.status, body=response.read())
        except urllib.error.HTTPError as error:
            with error:
                return TransportResponse(status=error.code, body=error.read())
