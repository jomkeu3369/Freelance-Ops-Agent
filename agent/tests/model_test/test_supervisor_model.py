from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from .supervisor_model import (
    DEFAULT_MODEL,
    FakeStructuredModel,
    FinalSupervisorResult,
    RequirementFinding,
    RequirementKind,
    RequirementsResult,
    RiskFinding,
    RiskResult,
    RiskSeverity,
    StrictModel,
    SupervisorPlan,
    SupervisorRequest,
    export_compiled_supervisor_graph,
    run_supervisor,
)


def fake_outputs() -> list[StrictModel]:
    return [
        SupervisorPlan(
            requirements_objective="회원가입 기능의 요구사항을 구조화한다.",
            risk_objective="인증 및 개인정보 위험을 검토한다.",
            shared_constraints=["사용자 입력 밖의 기능을 추가하지 않는다."],
            rationale="요구사항과 위험 분석이 모두 필요한 기능 제작 요청이다.",
        ),
        RequirementsResult(
            summary="회원가입 기능이 필요하다.",
            requirements=[
                RequirementFinding(
                    requirement_id="REQ-001",
                    kind=RequirementKind.FUNCTIONAL,
                    title="회원가입",
                    description="사용자는 계정을 생성할 수 있어야 한다.",
                    acceptance_criteria=["유효한 입력으로 계정을 생성한다."],
                    source_excerpt="회원가입 기능을 만들어 주세요.",
                    is_assumption=False,
                )
            ],
            assumptions=[],
            unresolved_questions=["지원할 인증 방식은 무엇인가요?"],
        ),
        RiskResult(
            summary="개인정보와 인증 정책 확인이 필요하다.",
            risks=[
                RiskFinding(
                    risk_id="RISK-001",
                    category="PRIVACY",
                    severity=RiskSeverity.MEDIUM,
                    description="수집할 개인정보 범위가 정해지지 않았다.",
                    affected_requirement_ids=["REQ-001"],
                    evidence_or_assumption="인증 방식과 수집 항목이 사용자 입력에 없다.",
                    mitigation="필수 수집 항목과 보관 정책을 확정한다.",
                    human_review_required=False,
                )
            ],
            missing_evidence=["개인정보 처리 정책"],
            human_review_required=False,
        ),
        FinalSupervisorResult(
            status="NEEDS_CLARIFICATION",
            summary="회원가입 요구사항 초안과 위험을 검토했다.",
            confirmed_requirement_ids=["REQ-001"],
            unresolved_questions=["지원할 인증 방식은 무엇인가요?"],
            risk_ids=["RISK-001"],
            conflicts=[],
            next_action="인증 방식과 개인정보 수집 범위를 확인한다.",
            user_message="회원가입 요구사항 초안을 만들었습니다. 인증 방식과 개인정보 범위를 확인해 주세요.",
        ),
    ]


def test_supervisor_executes_fixed_four_call_pipeline() -> None:
    model = FakeStructuredModel(fake_outputs())
    request = SupervisorRequest(requirement_text="회원가입 기능을 만들어 주세요.")

    result = run_supervisor(request, model)

    assert result["status"] == "NEEDS_CLARIFICATION"
    assert result["model"] == DEFAULT_MODEL
    assert result["model_call_count"] == 4
    assert result["output_tokens_used"] == 40
    assert cast(float, result["estimated_cost_usd"]) > 0
    assert model.stages == [
        "main_orchestrator",
        "requirements_supervisor",
        "risk_supervisor",
        "final_verifier",
    ]


def test_supervisor_stops_before_finalizer_when_output_budget_is_exhausted() -> None:
    model = FakeStructuredModel(fake_outputs(), tokens_per_call=200)
    request = SupervisorRequest(
        requirement_text="회원가입 기능을 만들어 주세요.",
        max_output_tokens=600,
    )

    result = run_supervisor(request, model)

    assert result["status"] == "BUDGET_EXCEEDED"
    assert result["model_call_count"] == 3
    assert model.stages == [
        "main_orchestrator",
        "requirements_supervisor",
        "risk_supervisor",
    ]
    assert result["final_result"] is None


def test_supervisor_stops_when_model_call_budget_is_exhausted() -> None:
    model = FakeStructuredModel(fake_outputs())
    request = SupervisorRequest(
        requirement_text="회원가입 기능을 만들어 주세요.",
        max_model_calls=2,
    )

    result = run_supervisor(request, model)

    assert result["status"] == "BUDGET_EXCEEDED"
    assert result["model_call_count"] == 2
    assert model.stages == ["main_orchestrator", "requirements_supervisor"]
    assert result["risk_result"] is None


def test_supervisor_rejects_a_route_cycle() -> None:
    with pytest.raises(ValidationError, match="cannot be visited twice"):
        SupervisorRequest(
            requirement_text="요구사항을 분석해 주세요.",
            route_history=["SIMPLE_LLM", "SUPERVISOR", "SIMPLE_LLM", "SUPERVISOR"],
        )


def test_exports_mermaid_from_the_compiled_graph(tmp_path: Path) -> None:
    artifacts = export_compiled_supervisor_graph(tmp_path, render_png=False)

    assert artifacts.mermaid_path == tmp_path / "supervisor_graph.mmd"
    assert artifacts.svg_path == tmp_path / "supervisor_graph.svg"
    assert artifacts.png_path is None
    mermaid = artifacts.mermaid_path.read_text(encoding="utf-8")
    assert "main_orchestrator" in mermaid
    assert "requirements_supervisor" in mermaid
    assert "risk_supervisor" in mermaid
    assert "final_verifier" in mermaid
    assert "__start__" in mermaid
    assert "__end__" in mermaid
    svg = artifacts.svg_path.read_text(encoding="utf-8")
    assert "Compiled Supervisor LangGraph" in svg
    assert "main_orchestrator" in svg
    assert 'class="edge conditional"' in svg
