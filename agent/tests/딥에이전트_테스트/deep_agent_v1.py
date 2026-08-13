import os
from typing import Literal

from tavily import TavilyClient
from deepagents import create_deep_agent
from deepagents.backends import StateBackend

from dotenv import load_dotenv
load_dotenv()

tavily_client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])

def internet_search(query: str, max_results: int = 5, topic: Literal["general", "news", "finance"] = "general", include_raw_content: bool = False):
    """Run a web search"""
    
    return tavily_client.search(query, max_results=max_results, include_raw_content=include_raw_content, topic=topic)
    
    
research_instructions = """You are an expert researcher. Your job is to conduct thorough research and then write a polished report.

You have access to an internet search tool as your primary means of gathering information.

## `internet_search`

Use this to run an internet search for a given query. You can specify the max number of results to return, the topic, and whether raw content should be included.
"""

agent = create_deep_agent(
    model="openai:gpt-5.5",
    tools=[internet_search],
    system_prompt=research_instructions,
    backend=StateBackend(),
)


result = agent.invoke(
    {
        "messages": [
            {
                "role": "user",
                "content": (
                    "StateBackend 테스트입니다. "
                    "/run/demo/report.md 파일에 "
                    "'StateBackend works'를 저장한 후 다시 읽어 확인하세요."
                ),
            }
        ]
    }
)

print(result["messages"][-1].content)

files = result.get("files", {})
print(files.keys())

report = files["/run/demo/report.md"]
print(report["content"])
print(report["encoding"])