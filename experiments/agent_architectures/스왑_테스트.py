import os

from langchain_openai import ChatOpenAI
from langchain.agents import create_agent
from langgraph.checkpoint.memory import InMemorySaver
from langgraph_swarm import create_swarm, create_handoff_tool
from langchain_core.tools import tool

from dotenv import load_dotenv
load_dotenv()

@tool
def process_refund(order_id: str) -> str:
    """주문 환불을 처리합니다."""
    return f"주문 {order_id}의 환불이 정상적으로 처리되었습니다. 3~5영업일 내 환불됩니다."


@tool
def check_tech_issue(issue: str) -> str:
    """기술 문제를 진단합니다."""
    return f"'{issue}' 문제 진단 결과: 캐시를 삭제하고 앱을 재시작하면 해결됩니다."


@tool
def general_help(question: str) -> str:
    """일반적인 문의에 답변합니다."""
    return f"'{question}'에 대한 답변: 자세한 안내를 드리겠습니다."


model = ChatOpenAI(model="gpt-5-mini", max_completion_tokens=1024)

transfer_to_billing = create_handoff_tool(
    agent_name="billing_agent",
    description="환불, 결제, 요금 관련 문의일 때 billing_agent로 전환합니다.",
)
transfer_to_tech = create_handoff_tool(
    agent_name="tech_agent",
    description="기술적 문제, 오류, 버그 관련 문의일 때 tech_agent로 전환합니다.",
)
transfer_to_general = create_handoff_tool(
    agent_name="general_agent",
    description="일반 문의로 돌아갈 때 general_agent로 전환합니다.",
)

general_agent = create_agent(
    model=model,
    tools=[general_help, transfer_to_billing, transfer_to_tech],
    name="general_agent",
    system_prompt=(
        "당신은 고객 지원 일반 상담사입니다. "
        "환불/결제 문의는 billing_agent로, 기술 문제는 tech_agent로 핸드오프하세요."
    ),
)

billing_agent = create_agent(
    model=model,
    tools=[process_refund, transfer_to_general],
    name="billing_agent",
    system_prompt="당신은 결제/환불 전문 상담사입니다. 환불 요청을 처리하세요.",
)

tech_agent = create_agent(
    model=model,
    tools=[check_tech_issue, transfer_to_general],
    name="tech_agent",
    system_prompt="당신은 기술 지원 전문가입니다. 기술 문제를 진단하고 해결책을 제시하세요.",
)

workflow = create_swarm(
    agents=[general_agent, billing_agent, tech_agent],
    default_active_agent="general_agent",
)

checkpointer = InMemorySaver()
app = workflow.compile(checkpointer=checkpointer)

config = {"configurable": {"thread_id": "customer_001"}}
result = app.invoke(
    {"messages": [{"role": "user", "content": "주문번호 ORD-12345 기술적으로 문제가 있는지 확인하고 문제가 있다면 환불해주세요"}]},
    config=config,
)

for msg in result["messages"]:
    if msg.content:
        name = getattr(msg, "name", msg.type)
        print(f"[{name}]: {msg.content[:200]}")
        print()