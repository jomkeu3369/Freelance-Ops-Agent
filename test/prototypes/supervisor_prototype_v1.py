from __future__ import annotations

import argparse
import json
import os
from functools import lru_cache
from typing import Any, Literal
from uuid import uuid4

from langchain.agents import create_agent
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from langsmith import traceable
from pydantic import BaseModel, Field

from test.prototypes.react_prototype_v1 import RequirementAnalysis, build_react_agent, configure_langsmith, create_chat_model, extract_requirement_analysis


class ClarificationQuestion(BaseModel):
    question_id: str
    field: str
    question: str
    reason: str
    priority: Literal["HIGH", "MEDIUM", "LOW"]


class ClarificationResult(BaseModel):
    questions: list[ClarificationQuestion] = Field(default_factory=list)


class SupervisorResult(BaseModel):
    status: Literal["READY", "NEEDS_INPUT", "BLOCKED"]
    requirement_analysis: RequirementAnalysis
    clarification_questions: list[ClarificationQuestion] = Field(default_factory=list)
    selected_agents: list[str] = Field(default_factory=list)
    final_message: str


class RequirementAnalystToolInput(BaseModel):
    request_text: str
    project_ref: str
    domain: str
    run_context_summary_json: str


class ClarificationGeneratorToolInput(BaseModel):
    requirement_analysis_json: str
    max_questions: int


CLARIFICATION_SYSTEM_PROMPT = """
당신은 Clarification Generator입니다.
Requirement Analyst가 반환한 blocking gap만 사용해 사용자가 답할 수 있는 최소 질문을 만드십시오.
이미 확정된 사실을 다시 묻지 말고, 하나의 질문에는 하나의 결정만 포함하십시오.
질문은 해결하려는 field와 이유를 포함해야 하며 새로운 요구사항을 제안하거나 가정하지 마십시오.
"""

SUPERVISOR_SYSTEM_PROMPT = """
당신은 Requirements Supervisor입니다.
직접 요구사항을 분석하지 말고 연결된 하위 Agent Tool을 조정하십시오.

항상 call_requirement_analyst를 먼저 한 번 호출하십시오.
분석 결과가 NEEDS_INPUT이면 call_clarification_generator를 한 번 호출하십시오.
분석 결과가 READY이면 질문 생성기를 호출하지 마십시오.
call_requirement_analyst의 run_context_summary_json과 call_clarification_generator의 requirement_analysis_json은 유효한 JSON 문자열로 전달하십시오.
call_clarification_generator를 호출할 때 max_questions는 5로 지정하십시오.
하위 Agent가 반환한 사실, gap 또는 assumption을 임의로 추가하거나 제거하지 마십시오.
selected_agents에는 실제 호출한 Agent Tool 이름만 기록하십시오.
비공개 사고 과정은 출력하지 말고 최종 상태와 사용자에게 필요한 메시지만 반환하십시오.
"""


@lru_cache(maxsize=4)
def build_clarification_agent(model_name: str | None = None):
    return create_agent(
        model=create_chat_model(model_name),
        tools=[],
        system_prompt=CLARIFICATION_SYSTEM_PROMPT,
        response_format=ClarificationResult,
        name="clarification_generator"
    )


@lru_cache(maxsize=4)
def build_supervisor_tools(model_name: str | None = None) -> tuple[Any, Any]:
    @tool(args_schema=RequirementAnalystToolInput)
    def call_requirement_analyst(request_text: str, project_ref: str, domain: str, run_context_summary_json: str) -> dict[str, Any]:
        """Always call this first. Delegate requirement analysis and return a structured draft, gaps, assumptions and next action."""
        run_context_summary = json.loads(run_context_summary_json)
        if not isinstance(run_context_summary, dict):
            raise ValueError("run_context_summary_json must contain a JSON object")
        message = {
            "role": "user",
            "content": json.dumps({
                "request_text": request_text,
                "project_ref": project_ref,
                "domain": domain,
                "run_context_summary": run_context_summary,
                "output_schema_version": "requirement-analysis.v1"
            }, ensure_ascii=False)
        }
        result = build_react_agent(model_name).invoke(
            {"messages": [message]},
            config={"run_name": "call_requirement_analyst", "tags": ["agent-tool", "requirement-analyst"]}
        )
        return extract_requirement_analysis(result).model_dump(mode="json")

    @tool(args_schema=ClarificationGeneratorToolInput)
    def call_clarification_generator(requirement_analysis_json: str, max_questions: int) -> dict[str, Any]:
        """Call only when requirement_analysis.status is NEEDS_INPUT. Convert blocking gaps into concise user questions."""
        requirement_analysis = json.loads(requirement_analysis_json)
        if not isinstance(requirement_analysis, dict):
            raise ValueError("requirement_analysis_json must contain a JSON object")
        analysis = RequirementAnalysis.model_validate(requirement_analysis)
        result = build_clarification_agent(model_name).invoke({
            "messages": [{
                "role": "user",
                "content": json.dumps({"requirement_analysis": analysis.model_dump(mode="json"), "max_questions": max_questions}, ensure_ascii=False)
            }]
        }, config={"run_name": "call_clarification_generator", "tags": ["agent-tool", "clarification-generator"]})
        structured_response = result.get("structured_response")
        clarification = structured_response if isinstance(structured_response, ClarificationResult) else ClarificationResult.model_validate(structured_response)
        return clarification.model_dump(mode="json")

    return call_requirement_analyst, call_clarification_generator


@lru_cache(maxsize=4)
def build_supervisor_agent(model_name: str | None = None):
    configure_langsmith()
    call_requirement_analyst, call_clarification_generator = build_supervisor_tools(model_name)
    return create_agent(
        model=create_chat_model(model_name),
        tools=[call_requirement_analyst, call_clarification_generator],
        system_prompt=SUPERVISOR_SYSTEM_PROMPT,
        response_format=SupervisorResult,
        name="requirements_supervisor"
    )


def extract_selected_tool_calls(messages: list[Any]) -> list[str]:
    selected: list[str] = []
    for message in messages:
        if isinstance(message, AIMessage):
            selected.extend(call.get("name", "unknown") for call in message.tool_calls)
    return selected


@traceable(name="supervisor_requirements_prototype_v1", run_type="chain")
def run_supervisor_prototype(inputs: dict[str, Any]) -> dict[str, Any]:
    configure_langsmith()
    request_text = str(inputs["request_text"])
    project_ref = str(inputs.get("project_ref", "project-fixture-001"))
    domain = str(inputs.get("domain", "ecommerce-admin"))
    run_id = str(inputs.get("run_id", uuid4()))
    result = build_supervisor_agent(inputs.get("model_name")).invoke(
        {
            "messages": [{
                "role": "user",
                "content": json.dumps({
                    "request_text": request_text,
                    "project_ref": project_ref,
                    "domain": domain,
                    "run_context_summary": inputs.get("run_context_summary", {}),
                    "output_schema_version": "requirements-supervisor.v1"
                }, ensure_ascii=False)
            }]
        },
        config={
            "run_name": "supervisor_requirements_prototype_v1",
            "tags": ["prototype-v1", "supervisor", "requirements"],
            "metadata": {"architecture": "supervisor", "run_id": run_id, "project_ref": project_ref, "domain": domain}
        }
    )
    structured_response = result.get("structured_response")
    supervisor_result = structured_response if isinstance(structured_response, SupervisorResult) else SupervisorResult.model_validate(structured_response)
    tool_calls = extract_selected_tool_calls(result.get("messages", []))
    return {
        "architecture": "supervisor",
        "run_id": run_id,
        "result": supervisor_result.model_dump(mode="json"),
        "tool_calls": tool_calls,
        "tool_call_count": len(tool_calls)
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the requirement-analysis Supervisor prototype")
    parser.add_argument("--request", required=True)
    parser.add_argument("--project-ref", default="project-fixture-001")
    parser.add_argument("--domain", default="ecommerce-admin")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    output = run_supervisor_prototype({"request_text": arguments.request, "project_ref": arguments.project_ref, "domain": arguments.domain})
    print(json.dumps(output, ensure_ascii=False, indent=2))
