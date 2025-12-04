from tavily import TavilyClient

client = TavilyClient("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")
response = client.search(
    query="디스코드py를 이용하여 음악 재생 봇 제작 비용"
)
print(response)