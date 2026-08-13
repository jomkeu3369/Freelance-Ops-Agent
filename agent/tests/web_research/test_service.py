from datetime import UTC, datetime

import pytest

from web_research import (
    AuthorityLevel,
    BoundedWebResearchService,
    SearchResult,
    WebDocument,
    WebProvider,
    WebResearchBudgetError,
)


class FakeRouter:
    def __init__(self, document: WebDocument) -> None:
        self.document = document
        self.search_calls = 0
        self.fetch_calls = 0

    async def search(self, request: object) -> list[SearchResult]:
        del request
        self.search_calls += 1
        return [
            SearchResult(
                title="공식 문서",
                url="https://example.go.kr/policy",
                snippet="공식 정책 요약",
                score=0.9,
                provider=WebProvider.TAVILY
            )
        ]

    async def fetch(self, request: object, dynamic: bool = False) -> WebDocument:
        del request, dynamic
        self.fetch_calls += 1
        return self.document


def _document(signals: list[str] | None = None) -> WebDocument:
    return WebDocument(
        source_url="https://example.go.kr/policy",
        final_url="https://example.go.kr/policy",
        title="공식 문서",
        content="검증 가능한 정책 원문",
        content_type="text/plain",
        content_sha256="a" * 64,
        fetched_at=datetime.now(UTC),
        parser_version="fixture-v1",
        provider=WebProvider.DIRECT_HTTP,
        jurisdiction="KR",
        authority_level=AuthorityLevel.OFFICIAL,
        prompt_injection_signals=signals or []
    )


async def test_collects_only_fetched_grounded_sources_with_budget_usage() -> None:
    router = FakeRouter(_document())
    service = BoundedWebResearchService(router, ["example.go.kr"])  # type: ignore[arg-type]

    result = await service.collect("프리랜서 정책", "KR", max_search_credits=1, max_tool_calls=2)

    assert len(result.sources) == 1
    assert result.sources[0].content_sha256 == "a" * 64
    assert result.search_credits == 1
    assert result.tool_calls == 2
    assert result.fetched_pages == 1


async def test_prompt_injection_document_is_not_exposed_to_model() -> None:
    router = FakeRouter(_document(["IGNORE_INSTRUCTIONS"]))
    service = BoundedWebResearchService(router, ["example.go.kr"])  # type: ignore[arg-type]

    result = await service.collect("프리랜서 정책", "KR", max_search_credits=1, max_tool_calls=2)

    assert result.sources == []
    assert result.fetched_pages == 0


async def test_research_requires_search_and_tool_budget() -> None:
    service = BoundedWebResearchService(FakeRouter(_document()), ["example.go.kr"])  # type: ignore[arg-type]

    with pytest.raises(WebResearchBudgetError, match="SEARCH_CREDIT_BUDGET_EXCEEDED"):
        await service.collect("프리랜서 정책", "KR", max_search_credits=0, max_tool_calls=2)
    with pytest.raises(WebResearchBudgetError, match="TOOL_CALL_BUDGET_EXCEEDED"):
        await service.collect("프리랜서 정책", "KR", max_search_credits=1, max_tool_calls=1)
