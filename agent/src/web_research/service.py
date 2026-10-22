"""운영 Research 부서가 사용하는 제한된 조사 수집 서비스."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

import httpx

from byok_budget import current_byok_ledger
from contracts import SourceReference
from platform_budget import PlatformBudgetError, require_platform_ledger

from .contracts import AuthorityLevel, FetchProvider, FetchRequest, SearchProvider, SearchRequest


class WebResearchBudgetError(RuntimeError):
    pass


@dataclass(frozen=True)
class ResearchCollection:
    sources: list[SourceReference]
    search_credits: int
    tool_calls: int
    fetched_pages: int


class BoundedWebResearchService:
    search_credits_required = 1
    def __init__(self, search: SearchProvider, fetch: FetchProvider, allowed_domains: list[str], max_results: int = 5, max_fetches: int = 3, timeout_seconds: float = 30.0) -> None:  # noqa: E501
        if not allowed_domains:
            raise ValueError("web research requires at least one allowed domain")

        if max_results < 1 or max_fetches < 1 or max_fetches > max_results:
            raise ValueError("web research result limits are invalid")

        if timeout_seconds <= 0:
            raise ValueError("web research timeout must be positive")

        self._search = search
        self._fetch = fetch
        self._allowed_domains = allowed_domains
        self._max_results = max_results
        self._max_fetches = max_fetches
        self._timeout_seconds = timeout_seconds

    async def collect(self, query: str, jurisdiction: str | None, max_search_credits: int, max_tool_calls: int) -> ResearchCollection:  # noqa: E501
        if current_byok_ledger() is not None:
            raise PlatformBudgetError("BYOK_WEB_RESEARCH_UNSUPPORTED")
        require_platform_ledger()
        if max_search_credits < 1:
            raise WebResearchBudgetError("SEARCH_CREDIT_BUDGET_EXCEEDED")

        if max_tool_calls < 2:
            raise WebResearchBudgetError("TOOL_CALL_BUDGET_EXCEEDED")

        async with asyncio.timeout(self._timeout_seconds):
            results = await self._search.search(
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
                    document = await self._fetch.fetch(
                        FetchRequest(
                            url=result.url,
                            allowed_domains=self._allowed_domains,
                            jurisdiction=jurisdiction,
                            authority_level=AuthorityLevel.UNKNOWN
                        )
                    )
                except (httpx.HTTPError, RuntimeError, ValueError):
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
                        excerpt=research_excerpt(document.content, query)
                    )
                )
            return ResearchCollection(
                sources=sources, search_credits=1, tool_calls=1 + attempted_fetches, fetched_pages=len(sources)
            )


def research_excerpt(content: str, query: str, limit: int = 4000) -> str:
    """문서 앞의 메뉴 대신 검색 주제와 가까운 연속 본문 구간을 발췌한다."""
    terms = set(re.findall(r"[a-z]{4,}", query.casefold())) - {"official", "documentation", "docs", "guide"}
    windows = [(index, content[index:index + 1250]) for index in range(0, len(content), 1100)]
    ranked = sorted(windows, key=lambda item: sum(item[1].casefold().count(term) for term in terms), reverse=True)
    selected = sorted(ranked[:3], key=lambda item: item[0])
    return "\n[발췌 구간]\n".join(text for _, text in selected)[:limit]
