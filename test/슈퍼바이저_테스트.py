import os

from langchain_openai import ChatOpenAI
from langchain.agents import create_agent
from langgraph_supervisor import create_supervisor
from langchain_core.tools import tool

from dotenv import load_dotenv
load_dotenv()

@tool
def search_web(query: str) -> str:
    """웹에서 정보를 검색합니다."""
    return (
        f"'{query}' 검색 결과:\n"
        "1. AI 에이전트 기술이 2025년 가장 주목받는 트렌드입니다.\n"
        "2. LangGraph, CrewAI 등 멀티 에이전트 프레임워크가 빠르게 성장 중입니다.\n"
        "3. 기업의 78%가 AI 에이전트 도입을 검토하고 있습니다."
    )

@tool
def write_document(content: str) -> str:
    """주어진 내용을 바탕으로 문서를 작성합니다."""
    return f"보고서 작성 완료:\n{content}"
model = ChatOpenAI(model="gpt-5-mini", max_completion_tokens=1024)

researcher = create_agent(
    model=model,
    tools=[search_web],
    name="researcher",
    system_prompt="당신은 리서치 전문가입니다. search_web 도구를 사용하여 주어진 주제에 대한 정보를 수집하세요.",
)

writer = create_agent(
    model=model,
    tools=[write_document],
    name="writer",
    system_prompt="당신은 보고서 작성 전문가입니다. 수집된 정보를 바탕으로 명확하고 구조화된 보고서를 작성하세요.",
)

workflow = create_supervisor(
    agents=[researcher, writer],
    parallel_tool_calls=True,
    model=model,
    prompt=(
        "당신은 팀 수퍼바이저입니다. "
        "조사가 필요하면 researcher에게, 보고서 작성이 필요하면 writer에게 위임하세요."
    ),
)

app = workflow.compile()
result = app.invoke({
    "messages": [
        {"role": "user", "content": "AI 에이전트 기술 동향을 조사하고 간단한 보고서를 작성해줘"}
    ]
})

for msg in result["messages"]:
    if msg.content:
        name = getattr(msg, "name", msg.type)
        print(f"[{name}]: {msg.content[:200]}")
        print()