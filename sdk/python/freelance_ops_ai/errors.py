"""호출자가 처리할 HTTP 상태와 플랫폼 오류 코드."""

from __future__ import annotations


class AIPlatformError(RuntimeError):
    """응답 본문 대신 HTTP 상태와 오류 코드만 제공한다."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(f"AI platform request failed: status={status} code={code}")
        self.status = status
        self.code = code
