"""검색 키 없이 지정된 공식 기술 문서를 조회한다. 일반 웹 검색으로 가장하지 않는다."""

from __future__ import annotations

import asyncio
from urllib.parse import urlsplit

import httpx

from byok_budget import current_byok_ledger
from contracts import SourceReference
from platform_budget import PlatformBudgetError, require_platform_ledger

from .contracts import AuthorityLevel, FetchProvider, FetchRequest, web_url
from .direct import DirectHttpProvider
from .service import ResearchCollection, research_excerpt

# 운영자가 관리하는 공개 공식 문서만 조회한다. 모델이 URL·호스트를 만들 수 없다.
DOCUMENTATION = [
    ({"stripe"}, "https://docs.stripe.com/webhooks"),
    ({"slack"}, "https://docs.slack.dev/apis/web-api/rate-limits/"),
    ({"next.js", "nextjs"}, "https://nextjs.org/docs/app/getting-started/caching"),
    ({"wcag", "w3c", "accessibility"}, "https://www.w3.org/WAI/WCAG22/quickref/"),
    ({"postgres", "postgresql"}, "https://www.postgresql.org/docs/current/backup.html"),
    ({"owasp", "rbac"}, "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html"),
]


class OfficialDocumentationResearch:
    search_credits_required = 0

    def __init__(self, fetch: FetchProvider | None = None) -> None:
        self._fetch = fetch or DirectHttpProvider()

    async def collect(self, query: str, jurisdiction: str | None, max_search_credits: int, max_tool_calls: int) -> ResearchCollection:  # noqa: E501
        del max_search_credits
        if current_byok_ledger() is not None:
            raise PlatformBudgetError("BYOK_WEB_RESEARCH_UNSUPPORTED")
        require_platform_ledger()
        tokens = set(query.casefold().split())
        urls = [url for topics, url in DOCUMENTATION if topics & tokens][:min(2, max_tool_calls)]
        sources: list[SourceReference] = []
        attempted = 0
        async with asyncio.timeout(25):
            for url in urls:
                attempted += 1
                try:
                    host = urlsplit(url).hostname
                    assert host is not None
                    document = await self._fetch.fetch(FetchRequest(
                        url=web_url(url), allowed_domains=[host], jurisdiction=jurisdiction,
                        authority_level=AuthorityLevel.OFFICIAL
                    ))
                    if document.prompt_injection_signals:
                        continue
                    sources.append(SourceReference(
                        title=document.title, url=str(document.final_url), provider=document.provider.value,
                        content_sha256=document.content_sha256, fetched_at=document.fetched_at,
                        authority_level="OFFICIAL", jurisdiction=jurisdiction,
                        excerpt=research_excerpt(document.content, query)
                    ))
                except (httpx.HTTPError, RuntimeError, ValueError):
                    continue
        return ResearchCollection(sources, 0, attempted, len(sources))
