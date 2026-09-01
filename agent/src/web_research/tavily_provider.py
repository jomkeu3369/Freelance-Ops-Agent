"""Tavily adapter for bounded source discovery."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .contracts import SearchRequest, SearchResult, WebProvider, web_url
from .security import UrlSecurityPolicy


class TavilyProviderError(RuntimeError):
    pass


class TavilySearchProvider:
    def __init__(self, client: Any, security: UrlSecurityPolicy | None = None) -> None:
        self._client = client
        self._security = security or UrlSecurityPolicy()

    async def search(self, request: SearchRequest) -> list[SearchResult]:
        response = await self._client.search(
            query=request.query,
            search_depth="basic",
            topic=request.topic,
            max_results=request.max_results,
            include_domains=request.allowed_domains,
            exclude_domains=request.excluded_domains,
            include_answer=False,
            include_raw_content=False,
            include_images=False
        )
        rows = self._rows(response)
        results: list[SearchResult] = []
        for row in rows[: request.max_results]:
            url = self._required_string(row, "url")
            await self._security.validate(url, request.allowed_domains, resolve_dns=False)
            
            results.append(
                SearchResult(
                    title=self._string(row.get("title"))[:500],
                    url=web_url(url),
                    snippet=self._string(row.get("content"))[:5000],
                    score=min(1.0, max(0.0, self._number(row.get("score")))),
                    published_at=self._date(row.get("published_date")),
                    provider=WebProvider.TAVILY
                )
            )
        
        return results

    @staticmethod
    def _rows(response: object) -> list[dict[str, Any]]:
        if not isinstance(response, dict) or not isinstance(response.get("results"), list):
            raise TavilyProviderError("Tavily response does not satisfy the expected schema")
        
        return [row for row in response["results"] if isinstance(row, dict)]

    @staticmethod
    def _required_string(row: dict[str, Any], key: str) -> str:
        value = row.get(key)
        if not isinstance(value, str) or not value.strip():
            raise TavilyProviderError(f"Tavily result is missing {key}")
       
        return value.strip()

    @staticmethod
    def _string(value: object) -> str:
        return value.strip() if isinstance(value, str) else ""

    @staticmethod
    def _number(value: object) -> float:
        return float(value) if isinstance(value, int | float) else 0.0

    @staticmethod
    def _date(value: object) -> datetime | None:
        if not isinstance(value, str) or not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
