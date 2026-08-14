"""Tavily adapter that exposes only provider-neutral web research contracts."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

from .contracts import CrawlPolicy, FetchRequest, SearchRequest, SearchResult, WebDocument, WebProvider, web_url
from .security import UrlSecurityPolicy, detect_prompt_injection


class TavilyProviderError(RuntimeError):
    pass


class TavilyWebResearchProvider:
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

    async def fetch(self, request: FetchRequest) -> WebDocument:
        url = await self._security.validate(str(request.url), request.allowed_domains)
        response = await self._client.extract(
            urls=[url],
            extract_depth="basic",
            include_images=False
        )
        
        rows = self._rows(response)
        if not rows:
            raise TavilyProviderError("Tavily did not return extracted content")
        
        return await self._document(rows[0], request)

    async def crawl(self, seed: FetchRequest, policy: CrawlPolicy) -> list[WebDocument]:
        seed_url = await self._security.validate(str(seed.url), policy.allowed_domains)
        response = await self._client.crawl(
            url=seed_url,
            max_depth=policy.max_depth,
            max_breadth=min(20, policy.max_pages),
            limit=policy.max_pages,
            allow_external=False
        )
        documents: list[WebDocument] = []
        
        for row in self._rows(response)[: policy.max_pages]:
            row_url = self._required_string(row, "url")
            await self._security.validate(row_url, policy.allowed_domains, resolve_dns=False)
            row_request = seed.model_copy(update={"url": row_url, "allowed_domains": policy.allowed_domains})
            documents.append(await self._document(row, row_request))
       
        return documents

    async def map(self, url: str, allowed_domains: list[str], max_pages: int = 20, max_depth: int = 2) -> list[str]:
        safe_url = await self._security.validate(url, allowed_domains)
        response = await self._client.map(
            url=safe_url,
            max_depth=max_depth,
            max_breadth=min(20, max_pages),
            limit=max_pages,
            allow_external=False
        )
        raw_results = response.get("results", []) if isinstance(response, dict) else []
        
        urls: list[str] = []
        for value in raw_results[:max_pages] if isinstance(raw_results, list) else []:
            safe_result = await self._security.validate(str(value), allowed_domains, resolve_dns=False)
            urls.append(safe_result)
        
        return urls

    async def _document(self, row: dict[str, Any], request: FetchRequest) -> WebDocument:
        url = self._required_string(row, "url")
        await self._security.validate(url, request.allowed_domains, resolve_dns=False)
        
        content = self._string(row.get("raw_content") or row.get("content")).strip() 
        if not content:
            raise TavilyProviderError("Tavily returned an empty document")
        
        content = content[:200000]
        title = self._string(row.get("title")) or content.splitlines()[0].lstrip("# ").strip()[:500]
        
        return WebDocument(
            source_url=request.url,
            final_url=web_url(url),
            title=title[:500],
            content=content,
            content_type="text/markdown",
            content_sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
            fetched_at=datetime.now(UTC),
            parser_version="tavily-extract-v1",
            provider=WebProvider.TAVILY,
            jurisdiction=request.jurisdiction,
            document_type=request.document_type,
            authority_level=request.authority_level,
            prompt_injection_signals=detect_prompt_injection(content)
        )

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
