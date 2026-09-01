from web_research import SearchRequest, TavilySearchProvider, UrlSecurityPolicy, WebProvider


async def public_resolver(host: str, port: int) -> list[str]:
    del host, port
    return ["93.184.216.34"]


class FakeTavilyClient:
    def __init__(self) -> None:
        self.search_kwargs: dict[str, object] = {}

    async def search(self, **kwargs: object) -> dict[str, object]:
        self.search_kwargs = kwargs
        return {
            "results": [
                {
                    "title": "Official notice",
                    "url": "https://law.example.com/notice",
                    "content": "notice summary",
                    "score": 0.9,
                }
            ]
        }


async def test_tavily_search_is_cost_bounded_and_domain_scoped() -> None:
    client = FakeTavilyClient()
    provider = TavilySearchProvider(client, UrlSecurityPolicy(public_resolver))

    results = await provider.search(
        SearchRequest(query="freelancer law", allowed_domains=["example.com"], max_results=5)
    )

    assert results[0].provider is WebProvider.TAVILY
    assert client.search_kwargs["search_depth"] == "basic"
    assert client.search_kwargs["include_domains"] == ["example.com"]
    assert client.search_kwargs["include_answer"] is False
    assert client.search_kwargs["include_raw_content"] is False
