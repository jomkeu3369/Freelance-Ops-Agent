from datetime import UTC, datetime
from unittest.mock import AsyncMock

from web_research.contracts import AuthorityLevel, WebDocument, WebProvider, web_url
from web_research.official_documentation import OfficialDocumentationResearch
from web_research.service import research_excerpt


async def test_only_registered_official_urls_are_fetched_and_search_credit_is_zero():
    fetch = AsyncMock()
    fetch.fetch.return_value = WebDocument(
        source_url=web_url("https://docs.stripe.com/webhooks"),
        final_url=web_url("https://docs.stripe.com/webhooks"), title="Webhook delivery",
        content="Events may be duplicated.", content_type="text/markdown", content_sha256="a" * 64,
        fetched_at=datetime.now(UTC), parser_version="plain-text-v1", provider=WebProvider.DIRECT_HTTP,
        authority_level=AuthorityLevel.OFFICIAL
    )
    tool = OfficialDocumentationResearch(fetch)
    result = await tool.collect("stripe webhook duplicate https://evil.test", "KR", 0, 1)
    assert result.search_credits == 0 and result.tool_calls == 1
    assert result.sources[0].authority_level == "OFFICIAL"
    assert str(fetch.fetch.call_args.args[0].url) == "https://docs.stripe.com/webhooks"
    assert fetch.fetch.call_args.args[0].allowed_domains == ["docs.stripe.com"]
    fetch.fetch.reset_mock()
    assert (await tool.collect("unknownvendor https://evil.test", "KR", 0, 2)).sources == []
    fetch.fetch.assert_not_awaited()


def test_excerpt_selects_relevant_body_instead_of_a_long_navigation_menu():
    content = "Navigation menu\n" * 800 + "Webhook duplicate events require idempotency.\n" * 30
    excerpt = research_excerpt(content, "webhook duplicate idempotency")
    assert "Webhook duplicate events require idempotency." in excerpt
    assert len(excerpt) <= 4000
