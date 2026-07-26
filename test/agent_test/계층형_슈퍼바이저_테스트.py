from langchain_openai import ChatOpenAI
from langchain.agents import create_agent
from langgraph_supervisor import create_supervisor
from langchain_core.tools import tool

from dotenv import load_dotenv
load_dotenv()
@tool
def search_web(query: str) -> str:
    """웹에서 정보를 검색합니다."""
    return f"'{query}' 검색 결과: 관련 기술 동향 및 사례 정보를 수집했습니다."


@tool
def analyze_data(data: str) -> str:
    """데이터를 분석합니다."""
    return f"분석 결과: '{data}'에 대한 핵심 인사이트 3가지를 도출했습니다."


@tool
def write_draft(topic: str) -> str:
    """초안을 작성합니다."""
    return f"'{topic}' 초안 작성 완료: 서론, 본론, 결론으로 구성된 보고서입니다."


@tool
def edit_text(text: str) -> str:
    """텍스트를 편집하고 교정합니다."""
    return f"편집 완료: 문법 교정, 문장 다듬기, 구조 개선이 적용되었습니다."


model = ChatOpenAI(model="gpt-5-mini", max_completion_tokens=1024)

searcher = create_agent(
    model=model, tools=[search_web],
    name="searcher", system_prompt="웹 검색으로 정보를 수집하세요.",
)
analyst = create_agent(
    model=model, tools=[analyze_data],
    name="analyst", system_prompt="수집된 정보를 분석하여 인사이트를 도출하세요.",
)

research_team = create_supervisor(
    agents=[searcher, analyst],
    model=model,
    prompt="당신은 리서치 팀 리더입니다. searcher에게 검색을, analyst에게 분석을 시키세요.",
    supervisor_name="research_lead",
    output_mode="last_message",
)
research_app = research_team.compile(name="research_team")

drafter = create_agent(
    model=model, tools=[write_draft],
    name="drafter", system_prompt="초안을 작성하세요.",
)
editor = create_agent(
    model=model, tools=[edit_text],
    name="editor", system_prompt="작성된 글을 편집하고 교정하세요.",
)

writing_team = create_supervisor(
    agents=[drafter, editor],
    model=model,
    prompt="당신은 작성 팀 리더입니다. drafter에게 초안 작성을, editor에게 편집을 시키세요.",
    supervisor_name="writing_lead",
    output_mode="last_message",
)
writing_app = writing_team.compile(name="writing_team")

top_supervisor = create_supervisor(
    agents=[research_app, writing_app],
    model=model,
    prompt=(
        "당신은 최상위 수퍼바이저입니다. "
        "먼저 research_team에게 조사를 시키고, "
        "그 결과를 바탕으로 writing_team에게 보고서 작성을 시키세요."
    ),
    output_mode="full_history",
)

app = top_supervisor.compile()
result = app.invoke({
    "messages": [
        {"role": "user", "content": "AI 멀티 에이전트 기술 동향 보고서를 작성해줘"}
    ]
})

for msg in result["messages"]:
    if msg.content:
        name = getattr(msg, "name", msg.type)
        print(f"[{name}]: {msg.content[:150]}")
        print()
