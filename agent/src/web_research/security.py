"""Fail-closed URL and external-content security policy."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable, Sequence
from urllib.parse import urlsplit


class WebResearchSecurityError(ValueError):
    pass


AddressResolver = Callable[[str, int], Awaitable[Sequence[str]]]


class UrlSecurityPolicy:
    def __init__(self, resolver: AddressResolver | None = None, require_https: bool = True) -> None:
        self._resolver = resolver or resolve_addresses
        self._require_https = require_https

    async def validate(self, url: str, allowed_domains: Sequence[str], resolve_dns: bool = True) -> str:
        parsed = urlsplit(url)
        if parsed.username is not None or parsed.password is not None:
            raise WebResearchSecurityError("URL credentials are forbidden")

        allowed_schemes = {"https"} if self._require_https else {"http", "https"}
        if parsed.scheme.lower() not in allowed_schemes:
            raise WebResearchSecurityError("URL scheme is forbidden")

        if parsed.fragment:
            parsed = parsed._replace(fragment="")

        host = (parsed.hostname or "").lower().rstrip(".")
        if not host or not any(host == domain or host.endswith("." + domain) for domain in allowed_domains):
            raise WebResearchSecurityError("URL host is outside the allowlist")

        if host in {"localhost", "localhost.localdomain"}:
            raise WebResearchSecurityError("local hostnames are forbidden")

        if resolve_dns:
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            addresses = await self._resolver(host, port)

            if not addresses:
                raise WebResearchSecurityError("URL host did not resolve")

            for address in addresses:
                if not is_public_address(address):
                    raise WebResearchSecurityError("URL resolves to a non-public address")

        return parsed.geturl()


async def resolve_addresses(host: str, port: int) -> Sequence[str]:
    def lookup() -> list[str]:
        return sorted({str(item[4][0]) for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})

    try:
        return await asyncio.wait_for(asyncio.to_thread(lookup), timeout=3.0)
    except (TimeoutError, OSError) as error:
        raise WebResearchSecurityError("URL DNS resolution failed") from error


def is_public_address(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return address.is_global and not any(
        (
            address.is_private,
            address.is_loopback,
            address.is_link_local,
            address.is_multicast,
            address.is_reserved,
            address.is_unspecified
        )
    )


_INJECTION_PATTERNS = {
    "IGNORE_INSTRUCTIONS": (
        "ignore previous instructions",
        "ignore all instructions",
        "이전 지시를 무시",
        "지시를 무시"
    ),
    "SYSTEM_PROMPT_REQUEST": ("system prompt", "developer message", "시스템 프롬프트", "개발자 메시지"),
    "TOOL_EXECUTION_REQUEST": (
        "call the tool",
        "execute this command",
        "run this command",
        "도구를 호출",
        "명령을 실행"
    ),
    "SECRET_EXFILTRATION": ("api key", "access token", "environment variable", "api 키", "접근 토큰", "환경 변수")
}


def detect_prompt_injection(content: str) -> list[str]:
    lowered = content.casefold()
    return [code for code, patterns in _INJECTION_PATTERNS.items() if any(pattern in lowered for pattern in patterns)]
