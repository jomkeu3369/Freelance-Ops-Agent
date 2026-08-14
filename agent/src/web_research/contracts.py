"""Provider-neutral contracts for bounded web discovery and collection."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, TypeAdapter, field_validator

_HTTP_URL_ADAPTER = TypeAdapter(HttpUrl)


def web_url(value: str) -> HttpUrl:
    return _HTTP_URL_ADAPTER.validate_python(value)


class WebModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WebProvider(StrEnum):
    TAVILY = "TAVILY"
    DIRECT_HTTP = "DIRECT_HTTP"
    CRAWL4AI = "CRAWL4AI"


class AuthorityLevel(StrEnum):
    OFFICIAL = "OFFICIAL"
    PRIMARY = "PRIMARY"
    SECONDARY = "SECONDARY"
    UNKNOWN = "UNKNOWN"


class SearchRequest(WebModel):
    query: str = Field(min_length=2, max_length=2000)
    allowed_domains: list[str] = Field(min_length=1, max_length=20)
    excluded_domains: list[str] = Field(default_factory=list, max_length=20)
    max_results: int = Field(default=5, ge=1, le=20)
    topic: str = Field(default="general", pattern="^(general|news|finance)$")

    @field_validator("allowed_domains", "excluded_domains")
    @classmethod
    def normalize_domains(cls, domains: list[str]) -> list[str]:
        normalized = [domain.strip().lower().rstrip(".") for domain in domains]
        if any(not domain or ":" in domain or "/" in domain for domain in normalized):
            raise ValueError("domains must be DNS names without scheme, port, or path")

        if len(normalized) != len(set(normalized)):
            raise ValueError("domains must not contain duplicates")

        return normalized


class SearchResult(WebModel):
    title: str = Field(max_length=500)
    url: HttpUrl
    snippet: str = Field(max_length=5000)
    score: float = Field(ge=0, le=1)
    published_at: datetime | None = None
    provider: WebProvider


class FetchRequest(WebModel):
    url: HttpUrl
    allowed_domains: list[str] = Field(min_length=1, max_length=20)
    jurisdiction: str | None = Field(default=None, max_length=32)
    document_type: str | None = Field(default=None, max_length=64)
    authority_level: AuthorityLevel = AuthorityLevel.UNKNOWN

    @field_validator("allowed_domains")
    @classmethod
    def normalize_allowed_domains(cls, domains: list[str]) -> list[str]:
        return SearchRequest.normalize_domains(domains)


class CrawlPolicy(WebModel):
    allowed_domains: list[str] = Field(min_length=1, max_length=20)
    max_pages: int = Field(default=10, ge=1, le=50)
    max_depth: int = Field(default=2, ge=0, le=3)
    respect_robots_txt: bool = True

    @field_validator("allowed_domains")
    @classmethod
    def normalize_allowed_domains(cls, domains: list[str]) -> list[str]:
        return SearchRequest.normalize_domains(domains)


class WebDocument(WebModel):
    source_url: HttpUrl
    final_url: HttpUrl
    title: str = Field(max_length=500)
    content: str = Field(min_length=1, max_length=200000)
    content_type: str = Field(max_length=100)
    content_sha256: str = Field(pattern="^[0-9a-f]{64}$")
    fetched_at: datetime
    parser_version: str = Field(min_length=1, max_length=100)
    provider: WebProvider
    jurisdiction: str | None = None
    document_type: str | None = None
    authority_level: AuthorityLevel
    untrusted_content: bool = True
    prompt_injection_signals: list[str] = Field(default_factory=list, max_length=20)


class SearchProvider(Protocol):
    async def search(self, request: SearchRequest) -> list[SearchResult]: ...


class FetchProvider(Protocol):
    async def fetch(self, request: FetchRequest) -> WebDocument: ...


class CrawlProvider(Protocol):
    async def crawl(self, seed: FetchRequest, policy: CrawlPolicy) -> list[WebDocument]: ...


class WebResearchProvider(SearchProvider, FetchProvider, CrawlProvider, Protocol):
    pass
