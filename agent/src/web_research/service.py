"""Bounded research collection used by the operational Research department."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from contracts import SourceReference

from .contracts import AuthorityLevel, FetchRequest, SearchRequest
from .router import WebResearchRouter


class WebResearchBudgetError(RuntimeError):
    pass


@dataclass(frozen=True)
class ResearchCollection:
    sources: list[SourceReference]
    search_credits: int
    tool_calls: int
    fetched_pages: int


class BoundedWebResearchService:
    def __init__(self, router: WebResearchRouter, allowed_domains: list[str], max_results: int = 5, max_fetches: int = 3, timeout_seconds: float = 30.0) -> None:  # noqa: E501
        if not allowed_domains:
            raise ValueError("web research requires at least one allowed domain")
        if max_results < 1 or max_fetches < 1 or max_fetches > max_results:
            raise ValueError("web research result limits are invalid")
        if timeout_seconds <= 0:
            raise ValueError("web research timeout must be positive")
        self._router = router
        self._allowed_domains = allowed_domains
        self._max_results = max_results
        self._max_fetches = max_fetches
        self._timeout_seconds = timeout_seconds

    async def collect(self, query: str, jurisdiction: str | None, max_search_credits: int, max_tool_calls: int) -> ResearchCollection:  # noqa: E501
        if max_search_credits < 1:
            raise WebResearchBudgetError("SEARCH_CREDIT_BUDGET_EXCEEDED")
        if max_tool_calls < 2:
            raise WebResearchBudgetError("TOOL_CALL_BUDGET_EXCEEDED")
        async with asyncio.timeout(self._timeout_seconds):
            results = await self._router.search(
                SearchRequest(
                    query=query,
                    allowed_domains=self._allowed_domains,
                    max_results=min(self._max_results, max_tool_calls - 1)
                )
            )
            sources: list[SourceReference] = []
            fetch_limit = min(self._max_fetches, len(results), max_tool_calls - 1)
            attempted_fetches = 0
            for result in results[:fetch_limit]:
                attempted_fetches += 1
                try:
                    document = await self._router.fetch(
                        FetchRequest(
                            url=result.url,
                            allowed_domains=self._allowed_domains,
                            jurisdiction=jurisdiction,
                            authority_level=AuthorityLevel.UNKNOWN
                        )
                    )
                except (RuntimeError, ValueError):
                    continue
                if document.prompt_injection_signals:
                    continue
                sources.append(
                    SourceReference(
                        title=document.title,
                        url=str(document.final_url),
                        provider=document.provider.value,
                        content_sha256=document.content_sha256,
                        fetched_at=document.fetched_at,
                        authority_level=document.authority_level.value,
                        jurisdiction=document.jurisdiction,
                        excerpt=document.content[:4000]
                    )
                )
            return ResearchCollection(
                sources=sources,
                search_credits=1,
                tool_calls=1 + attempted_fetches,
                fetched_pages=len(sources)
            )
