"""Secure provider-neutral web research boundary."""

from .contracts import (
    AuthorityLevel,
    CrawlPolicy,
    FetchProvider,
    FetchRequest,
    SearchRequest,
    SearchResult,
    WebDocument,
    WebProvider,
    WebResearchProvider,
)
from .crawl4ai_provider import Crawl4AIProviderError, Crawl4AIWebResearchProvider
from .direct import DirectFetchError, DirectHttpProvider
from .router import WebResearchRouter
from .security import UrlSecurityPolicy, WebResearchSecurityError, detect_prompt_injection
from .service import BoundedWebResearchService, ResearchCollection, WebResearchBudgetError
from .tavily_provider import TavilyProviderError, TavilyWebResearchProvider

__all__ = [
    "AuthorityLevel",
    "BoundedWebResearchService",
    "Crawl4AIProviderError",
    "Crawl4AIWebResearchProvider",
    "CrawlPolicy",
    "DirectFetchError",
    "DirectHttpProvider",
    "FetchRequest",
    "FetchProvider",
    "SearchRequest",
    "SearchResult",
    "ResearchCollection",
    "TavilyProviderError",
    "TavilyWebResearchProvider",
    "UrlSecurityPolicy",
    "WebDocument",
    "WebProvider",
    "WebResearchProvider",
    "WebResearchRouter",
    "WebResearchBudgetError",
    "WebResearchSecurityError",
    "detect_prompt_injection"
]
