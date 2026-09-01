"""Secure provider-neutral web research boundary."""

from .contracts import (
    AuthorityLevel,
    FetchProvider,
    FetchRequest,
    SearchProvider,
    SearchRequest,
    SearchResult,
    WebDocument,
    WebProvider,
)
from .direct import DirectFetchError, DirectHttpProvider
from .security import UrlSecurityPolicy, WebResearchSecurityError, detect_prompt_injection
from .service import BoundedWebResearchService, ResearchCollection, WebResearchBudgetError
from .tavily_provider import TavilyProviderError, TavilySearchProvider

__all__ = [
    "AuthorityLevel",
    "BoundedWebResearchService",
    "DirectFetchError",
    "DirectHttpProvider",
    "FetchRequest",
    "FetchProvider",
    "SearchProvider",
    "SearchRequest",
    "SearchResult",
    "ResearchCollection",
    "TavilyProviderError",
    "TavilySearchProvider",
    "UrlSecurityPolicy",
    "WebDocument",
    "WebProvider",
    "WebResearchBudgetError",
    "WebResearchSecurityError",
    "detect_prompt_injection"
]
