from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import uuid4

from contracts import PlatformBudget
from platform_budget import TEXT_TARIFF_VERSION, PlatformSpendLedger, platform_budget_scope
from web_research.contracts import AuthorityLevel, WebDocument, WebProvider, web_url
from web_research.official_documentation import ConversationWebResearch, OfficialDocumentationResearch
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


def test_rate_limit_excerpt_keeps_retry_instructions_over_repetitive_generic_terms():
    content = ("Rate limits differ across rate limit tiers.\n" * 500
               + "When HTTP 429 is returned, wait for Retry-After before retrying.\n" * 5
               + "Rate limits differ across rate limit tiers.\n" * 500)
    assert "wait for Retry-After" in research_excerpt(content, "slack API rate limits")


async def test_previous_backend_budget_uses_official_documents_without_paid_search():
    paid, official = AsyncMock(), AsyncMock()
    ledger = PlatformSpendLedger(PlatformBudget(
        reservation_id=uuid4(), max_cost_usd=Decimal("0.10"), tariff_version=TEXT_TARIFF_VERSION,
        valid_until=datetime.now(UTC) + timedelta(minutes=1)
    ))
    tool = ConversationWebResearch(paid, official)
    with platform_budget_scope(ledger):
        await tool.collect("stripe webhook", "KR", 1, 4)
    paid.collect.assert_not_awaited()
    official.collect.assert_awaited_once_with("stripe webhook", "KR", 0, 4)


async def test_nextjs_invalidation_loads_the_revalidation_guide_within_the_page_budget():
    fetch = AsyncMock()
    fetch.fetch.return_value = WebDocument(
        source_url=web_url("https://nextjs.org/docs/app/getting-started/revalidating"),
        final_url=web_url("https://nextjs.org/docs/app/getting-started/revalidating"), title="Revalidating",
        content="Manually invalidate cached data after a mutation using revalidateTag, updateTag, or revalidatePath.",
        content_type="text/markdown", content_sha256="a" * 64, fetched_at=datetime.now(UTC),
        parser_version="plain-text-v1", provider=WebProvider.DIRECT_HTTP, authority_level=AuthorityLevel.OFFICIAL
    )
    result = await OfficialDocumentationResearch(fetch).collect("next.js cache invalidation", None, 0, 2)
    assert result.tool_calls == 2 and result.search_credits == 0
    assert [str(call.args[0].url) for call in fetch.fetch.await_args_list] == [
        "https://nextjs.org/docs/app/getting-started/caching",
        "https://nextjs.org/docs/app/getting-started/revalidating"
    ]
