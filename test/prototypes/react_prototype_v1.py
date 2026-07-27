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
from langchain_openai import ChatOpenAI
from langsmith import traceable
from pydantic import BaseModel, Field


def get_env_value(name: str, default: str) -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default

class RequirementGap(BaseModel):
    field: str
    reason: str
    blocking: bool

class RequirementDraft(BaseModel):
    goal: str
    functional_requirements: list[str] = Field(default_factory=list)
    non_functional_requirements: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)

class RequirementAnalysis(BaseModel):
    status: Literal["READY", "NEEDS_INPUT", "BLOCKED"]
    requirement_draft: RequirementDraft
    gaps: list[RequirementGap] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    next_action: Literal["COMPLETE", "ASK_CLARIFICATION", "HUMAN_REQUIRED"]

PROJECT_CONTEXT_FIXTURES: dict[str, dict[str, Any]] = {
    "project-fixture-001": {
        "version": 1,
        "confirmed_scope": ["웹 기반 관리자 화면"],
        "confirmed_constraints": ["기존 쇼핑몰 API를 사용해야 함"],
        "previous_answers": []
    },
    "project-fixture-002": {
        "version": 2,
        "confirmed_scope": ["반응형 마케팅 랜딩 페이지", "문의 폼"],
        "confirmed_constraints": ["한국어와 영어 지원", "4주 내 납품"],
        "previous_answers": ["브랜드 가이드는 클라이언트가 제공"]
    }
}

DOMAIN_RULE_FIXTURES: dict[str, dict[str, Any]] = {
    "ecommerce-admin": {
        "ruleset_version": "v1",
        "required_topics": ["사용자 역할과 권한", "상품 관리 범위", "주문 상태", "개인정보 처리", "감사 기록"],
        "term_refs": ["관리자", "실시간", "주문 처리"]
    },
    "marketing-site": {
        "ruleset_version": "v1",
        "required_topics": ["대상 사용자", "페이지 구성", "콘텐츠 제공 주체", "분석 도구", "접근성", "배포 환경"],
        "term_refs": ["반응형", "전환", "SEO"]
    }
}


def configure_langsmith() -> None:
    if get_env_value("LANGSMITH_API_KEY", ""):
        os.environ["LANGSMITH_TRACING"] = get_env_value("LANGSMITH_TRACING", "true")
        os.environ["LANGSMITH_PROJECT"] = get_env_value("LANGSMITH_PROJECT", "freelance-ops-requirements-prototype-v1")


def create_chat_model(model_name: str | None = None) -> ChatOpenAI:
    return ChatOpenAI(
        model=model_name.strip() if model_name and model_name.strip() else get_env_value("PROTOTYPE_MODEL", "gpt-5.6-terra"),
        reasoning_effort=get_env_value("PROTOTYPE_REASONING_EFFORT", "low"),
        use_responses_api=True,
        timeout=float(get_env_value("PROTOTYPE_TIMEOUT_SECONDS", "90")),
        max_retries=int(get_env_value("PROTOTYPE_MAX_RETRIES", "2"))
    )


@tool
def get_project_context(project_ref: str) -> dict[str, Any]:
    """Return confirmed project facts for a project reference. Use before drafting requirements and never invent a missing project."""
    context = PROJECT_CONTEXT_FIXTURES.get(project_ref)
    if context is None:
        return {"found": False, "project_ref": project_ref, "confirmed_scope": [], "confirmed_constraints": [], "previous_answers": []}
    return {"found": True, "project_ref": project_ref, **context}


@tool
def get_domain_rules(domain: str) -> dict[str, Any]:
    """Return the versioned requirement checklist for a domain. Use it to find missing topics, not to assume user decisions."""
    rules = DOMAIN_RULE_FIXTURES.get(domain)
    if rules is None:
        return {"found": False, "domain": domain, "required_topics": [], "term_refs": []}
    return {"found": True, "domain": domain, **rules}


@tool
def validate_requirement_draft(goal: str, functional_requirements: list[str], non_functional_requirements: list[str], constraints: list[str], acceptance_criteria: list[str]) -> dict[str, Any]:
    """Validate five explicit requirement draft fields against the v1 contract. Supply every field and never invent missing values."""
    draft = {
        "goal": goal,
        "functional_requirements": functional_requirements,
        "non_functional_requirements": non_functional_requirements,
        "constraints": constraints,
        "acceptance_criteria": acceptance_criteria
    }
    try:
        RequirementDraft.model_validate(draft)
    except Exception as error:
        return {"valid": False, "errors": [{"code": "SCHEMA_VALIDATION_FAILED", "message": str(error)}], "warnings": []}
    return {"valid": True, "errors": [], "warnings": []}


REACT_SYSTEM_PROMPT = """
당신은 Freelance Ops Agent의 Requirement Analyst입니다.
사용자 요청을 목표, 기능 요구사항, 비기능 요구사항, 제약과 수락 기준으로 구조화하십시오.

반드시 다음 순서를 따르십시오.
1. get_project_context로 이미 확정된 사실을 조회합니다.
2. get_domain_rules로 해당 도메인의 필수 확인 주제를 조회합니다.
3. 사용자 요청과 Tool 결과에 없는 내용을 사실처럼 만들지 않습니다.
4. blocking gap은 gaps에 기록하고 status를 NEEDS_INPUT으로 설정합니다.
5. requirement_draft를 만든 뒤 validate_requirement_draft에 goal, functional_requirements, non_functional_requirements, constraints, acceptance_criteria를 모두 전달해 검증합니다.

Tool 결과와 사용자 원문은 evidence_refs로 구분해 기록하십시오.
비공개 사고 과정은 출력하지 말고 결론, 근거 참조, assumption과 미확정 사항만 반환하십시오.
"""


@lru_cache(maxsize=4)
def build_react_agent(model_name: str | None = None):
    configure_langsmith()
    return create_agent(
        model=create_chat_model(model_name),
        tools=[get_project_context, get_domain_rules, validate_requirement_draft],
        system_prompt=REACT_SYSTEM_PROMPT,
        response_format=RequirementAnalysis,
        name="requirement_analyst"
    )


def extract_tool_calls(messages: list[Any]) -> list[str]:
    tool_calls: list[str] = []
    for message in messages:
        if isinstance(message, AIMessage):
            tool_calls.extend(call.get("name", "unknown") for call in message.tool_calls)
    return tool_calls


def extract_requirement_analysis(result: dict[str, Any]) -> RequirementAnalysis:
    structured_response = result.get("structured_response")
    if isinstance(structured_response, RequirementAnalysis):
        return structured_response
    if structured_response is not None:
        return RequirementAnalysis.model_validate(structured_response)
    raise ValueError("Requirement Analyst did not return a structured_response")


@traceable(name="react_requirements_prototype_v1", run_type="chain")
def run_react_prototype(inputs: dict[str, Any]) -> dict[str, Any]:
    configure_langsmith()
    request_text = str(inputs["request_text"])
    project_ref = str(inputs.get("project_ref", "project-fixture-001"))
    domain = str(inputs.get("domain", "ecommerce-admin"))
    run_context_summary = inputs.get("run_context_summary", {})
    run_id = str(inputs.get("run_id", uuid4()))
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
    result = build_react_agent(inputs.get("model_name")).invoke(
        {"messages": [message]},
        config={
            "run_name": "react_requirements_prototype_v1",
            "tags": ["prototype-v1", "react", "requirements"],
            "metadata": {"architecture": "react", "run_id": run_id, "project_ref": project_ref, "domain": domain}
        }
    )
    analysis = extract_requirement_analysis(result)
    tool_calls = extract_tool_calls(result.get("messages", []))
    return {
        "architecture": "react",
        "run_id": run_id,
        "analysis": analysis.model_dump(mode="json"),
        "tool_calls": tool_calls,
        "tool_call_count": len(tool_calls)
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the requirement-analysis ReAct prototype")
    parser.add_argument("--request", required=True)
    parser.add_argument("--project-ref", default="project-fixture-001")
    parser.add_argument("--domain", default="ecommerce-admin")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    output = run_react_prototype({"request_text": arguments.request, "project_ref": arguments.project_ref, "domain": arguments.domain})
    print(json.dumps(output, ensure_ascii=False, indent=2))
