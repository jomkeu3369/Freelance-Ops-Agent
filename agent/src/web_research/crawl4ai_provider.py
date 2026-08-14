"""Bounded Crawl4AI adapter for allowlisted dynamic pages."""

from __future__ import annotations

import hashlib
from collections import deque
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime
from typing import Any, cast
from urllib.parse import urljoin

from .contracts import CrawlPolicy, FetchRequest, SearchRequest, SearchResult, WebDocument, WebProvider, web_url
from .security import UrlSecurityPolicy, detect_prompt_injection


class Crawl4AIProviderError(RuntimeError):
    pass


CrawlerFactory = Callable[[], AbstractAsyncContextManager[Any]]
RunConfigFactory = Callable[[CrawlPolicy], Any]


class Crawl4AIWebResearchProvider:
    def __init__(self, crawler_factory: CrawlerFactory, run_config_factory: RunConfigFactory, security: UrlSecurityPolicy | None = None) -> None:  # noqa: E501
        self._crawler_factory = crawler_factory
        self._run_config_factory = run_config_factory
        self._security = security or UrlSecurityPolicy()

    @classmethod
    def default(cls, security: UrlSecurityPolicy | None = None) -> Crawl4AIWebResearchProvider:
        try:
            from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig  # type: ignore[import-not-found]  # noqa: E501, I001
        except ImportError as error:
            raise Crawl4AIProviderError("Crawl4AI optional runtime is not installed") from error

        def crawler_factory() -> AbstractAsyncContextManager[Any]:
            crawler = AsyncWebCrawler(
                config=BrowserConfig(
                    headless=True,
                    verbose=False
                )
            )
            return cast(AbstractAsyncContextManager[Any], crawler)

        def run_config_factory(policy: CrawlPolicy) -> Any:
            return CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                check_robots_txt=policy.respect_robots_txt,
                page_timeout=20_000,
                verbose=False
            )

        return cls(crawler_factory, run_config_factory, security)

    async def search(self, request: SearchRequest) -> list[SearchResult]:
        del request
        raise Crawl4AIProviderError("Crawl4AI does not provide source discovery")

    async def fetch(self, request: FetchRequest) -> WebDocument:
        policy = CrawlPolicy(allowed_domains=request.allowed_domains, max_pages=1, max_depth=0)
        documents = await self.crawl(request, policy)
        if not documents:
            raise Crawl4AIProviderError("Crawl4AI did not return a document")
        return documents[0]

    async def crawl(self, seed: FetchRequest, policy: CrawlPolicy) -> list[WebDocument]:
        queue: deque[tuple[str, int]] = deque([(str(seed.url), 0)])
        visited: set[str] = set()
        documents: list[WebDocument] = []
        config = self._run_config_factory(policy)

        async with self._crawler_factory() as crawler:
            while queue and len(documents) < policy.max_pages:
                candidate, depth = queue.popleft()

                safe_url = await self._security.validate(candidate, policy.allowed_domains)
                if safe_url in visited:
                    continue

                visited.add(safe_url)
                result = await crawler.arun(url=safe_url, config=config)

                if not bool(getattr(result, "success", False)):
                    raise Crawl4AIProviderError("Crawl4AI collection failed")

                final_url = str(getattr(result, "url", safe_url))
                await self._security.validate(final_url, policy.allowed_domains, resolve_dns=False)
                content = self._markdown(result).strip()[:200000]

                if content:
                    documents.append(self._document(seed, safe_url, final_url, content))

                if depth < policy.max_depth:
                    for link in self._internal_links(result):
                        try:
                            absolute_link = urljoin(final_url, link)
                            safe_link = await self._security.validate(
                                absolute_link,
                                policy.allowed_domains,
                                resolve_dns=False
                            )
                        except ValueError:
                            continue

                        if safe_link not in visited:
                            queue.append((safe_link, depth + 1))

        return documents

    @staticmethod
    def _markdown(result: object) -> str:
        markdown = getattr(result, "markdown", "")
        raw_markdown = getattr(markdown, "raw_markdown", None)
        if isinstance(raw_markdown, str):
            return raw_markdown

        return markdown if isinstance(markdown, str) else str(markdown or "")

    @staticmethod
    def _internal_links(result: object) -> list[str]:
        links = getattr(result, "links", {})
        internal = links.get("internal", []) if isinstance(links, dict) else []
        urls: list[str] = []

        for item in internal if isinstance(internal, list) else []:

            if isinstance(item, str):
                urls.append(item)

            elif isinstance(item, dict) and isinstance(item.get("href"), str):
                urls.append(item["href"])

        return urls

    @staticmethod
    def _document(seed: FetchRequest, source_url: str, final_url: str, content: str) -> WebDocument:
        title = content.splitlines()[0].lstrip("# ").strip()[:500] or final_url
        return WebDocument(
            source_url=web_url(source_url),
            final_url=web_url(final_url),
            title=title,
            content=content,
            content_type="text/markdown",
            content_sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
            fetched_at=datetime.now(UTC),
            parser_version="crawl4ai-0.9-v1",
            provider=WebProvider.CRAWL4AI,
            jurisdiction=seed.jurisdiction,
            document_type=seed.document_type,
            authority_level=seed.authority_level,
            prompt_injection_signals=detect_prompt_injection(content)
        )
