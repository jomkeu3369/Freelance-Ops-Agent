"""Deterministic provider routing; Agent text never selects an SDK directly."""

from __future__ import annotations

from .contracts import (
    CrawlPolicy,
    FetchProvider,
    FetchRequest,
    SearchRequest,
    SearchResult,
    WebDocument,
    WebProvider,
    WebResearchProvider,
)


class WebResearchRouter:
    def __init__(self, tavily: WebResearchProvider, direct: FetchProvider, crawl4ai: WebResearchProvider | None = None) -> None:  # noqa: E501
        self._tavily = tavily
        self._direct = direct
        self._crawl4ai = crawl4ai

    async def search(self, request: SearchRequest) -> list[SearchResult]:
        return await self._tavily.search(request)

    async def fetch(self, request: FetchRequest, dynamic: bool = False) -> WebDocument:
        if dynamic:
            if self._crawl4ai is None:
                raise RuntimeError("dynamic web collection is not configured")
            return await self._crawl4ai.fetch(request)

        return await self._direct.fetch(request)

    async def crawl(self, seed: FetchRequest, policy: CrawlPolicy, provider: WebProvider) -> list[WebDocument]:
        if provider is WebProvider.TAVILY:
            return await self._tavily.crawl(seed, policy)

        if provider is WebProvider.CRAWL4AI and self._crawl4ai is not None:
            return await self._crawl4ai.crawl(seed, policy)

        raise ValueError("selected provider does not support bounded crawl")
