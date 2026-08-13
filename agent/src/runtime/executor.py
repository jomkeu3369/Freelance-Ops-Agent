"""Operational route and department execution within explicit run budgets."""

from __future__ import annotations

import json
from typing import Protocol
from uuid import UUID, uuid4

from contracts import (
    AgentInterruption,
    AgentRunRequest,
    AgentRunResult,
    DepartmentName,
    DepartmentResult,
    DirectToolOperation,
    InterruptionKind,
    ProjectContext,
    ResumeAgentRunRequest,
)
from integrations import SpringToolError
from providers import ModelProvider
from routing import FinalRouteDecision, RouteLabel, SafetyContext
from routing.llm_evaluator import RouteDecisionSource

from .runs import AgentExecutionError, ExecutionAuthorization, ExecutionOutcome


class OperationalGateway(Protocol):
    async def route(self, text: str, safety_context: SafetyContext | None = None) -> FinalRouteDecision: ...


class ProjectContextTool(Protocol):
    async def get_project_context(self, delegation_token: str, *, run_id: UUID, project_id: UUID, max_attempts: int | None = None, traceparent: str | None = None) -> ProjectContext: ...  # noqa: E501


class FailClosedOperationalGateway:
    """Keeps the service available while refusing runs when routing is unconfigured."""

    async def route(self, text: str, safety_context: SafetyContext | None = None) -> FinalRouteDecision:
        del text, safety_context
        return FinalRouteDecision(
            route=RouteLabel.HUMAN_REQUIRED,
            source=RouteDecisionSource.FAIL_CLOSED,
            local_decision=None,
            failure_code="ROUTE_EVALUATOR_NOT_CONFIGURED",
        )


_ROUTE_DEPARTMENTS: dict[RouteLabel, tuple[DepartmentName, ...]] = {
    RouteLabel.DIRECT_TOOL: (DepartmentName.VERIFICATION,),
    RouteLabel.SIMPLE_LLM: (DepartmentName.REQUIREMENTS,),
    RouteLabel.REACT_AGENT: (DepartmentName.REQUIREMENTS, DepartmentName.RESEARCH),
    RouteLabel.SUPERVISOR: (
        DepartmentName.REQUIREMENTS,
        DepartmentName.RESEARCH,
        DepartmentName.DEAL_DESIGN,
        DepartmentName.VERIFICATION,
    ),
    RouteLabel.HUMAN_REQUIRED: (),
}


class OperationalAgentExecutor:
    def __init__(self, gateway: OperationalGateway, provider: ModelProvider, project_context_tool: ProjectContextTool | None = None) -> None:  # noqa: E501
        self._gateway = gateway
        self._provider = provider
        self._project_context_tool = project_context_tool

    async def execute(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None = None, authorization: ExecutionAuthorization | None = None) -> ExecutionOutcome:  # noqa: E501
        if request.budget.max_model_calls < 1:
            raise AgentExecutionError("MODEL_CALL_BUDGET_EXCEEDED")
        text = request.input.requirement_text
        if resume is not None:
            answers = [
                {"question_index": answer.question_index, "answer": answer.answer}
                for answer in resume.answers
            ]
            text = f"{text}\n\nTrusted user clarification:\n{json.dumps(answers, ensure_ascii=False)}"

        safety = SafetyContext(
            external_side_effect=request.safety_context.external_side_effect,
            sensitive_data=request.safety_context.sensitive_data,
            financial_authority_required=request.safety_context.financial_authority_required,
            legal_authority_required=request.safety_context.legal_authority_required,
            irreversible_action=request.safety_context.irreversible_action,
            approval_required=request.safety_context.approval_required,
            authority_verified=request.safety_context.authority_verified,
        )
        decision = await self._gateway.route(text, safety)
        input_tokens = decision.llm_evaluation.input_tokens if decision.llm_evaluation is not None else 0
        output_tokens = decision.llm_evaluation.output_tokens if decision.llm_evaluation is not None else 0
        self._enforce_token_budget(request, input_tokens, output_tokens)
        if decision.route is RouteLabel.HUMAN_REQUIRED:
            return ExecutionOutcome(
                interruption=AgentInterruption(
                    interruption_id=uuid4(),
                    kind=InterruptionKind.RISK_DECISION,
                    questions=[
                        "이 요청은 자동 실행할 수 없습니다. 권한과 위험을 검토한 뒤 계속할지 결정해 주세요."
                    ],
                )
            )

        if decision.route is RouteLabel.DIRECT_TOOL:
            # 자연어를 Tool 이름으로 해석하지 않고 Spring이 보낸 구조화된 작업만 실행합니다.
            if request.input.direct_tool_operation is not DirectToolOperation.GET_PROJECT_CONTEXT:
                raise AgentExecutionError("DIRECT_TOOL_INPUT_REQUIRED")
            direct_context = await self._load_project_context(request, authorization)
            direct_summary = json.dumps(direct_context.model_dump(mode="json", by_alias=True), ensure_ascii=False)
            return ExecutionOutcome(
                result=AgentRunResult(
                    project_summary=direct_summary,
                    department_results=[
                        DepartmentResult(
                            department=DepartmentName.VERIFICATION,
                            status="COMPLETED",
                            summary=direct_summary,
                        )
                    ],
                ),
                active_department=DepartmentName.VERIFICATION,
            )

        if decision.route is RouteLabel.SUPERVISOR and request.budget.max_hierarchy_depth < 2:
            raise AgentExecutionError("HIERARCHY_DEPTH_EXCEEDED")

        departments = _ROUTE_DEPARTMENTS[decision.route][: request.budget.max_departments]
        if max(0, len(departments) - 1) > request.budget.max_handoffs:
            raise AgentExecutionError("HANDOFF_BUDGET_EXCEEDED")
        required_model_calls = 1 + len(departments)
        if request.budget.max_model_calls < required_model_calls:
            raise AgentExecutionError("MODEL_CALL_BUDGET_EXCEEDED")

        project_context: ProjectContext | None = None
        if decision.route in {RouteLabel.REACT_AGENT, RouteLabel.SUPERVISOR}:
            project_context = await self._load_project_context(request, authorization)

        results: list[DepartmentResult] = []
        questions: list[str] = []
        used_model_calls = 1
        for department in departments:
            generation = await self._provider.generate_structured(
                request.model_selection,
                self._department_prompt(department, decision.route, text, project_context),
                max_output_tokens=max(1, request.budget.max_output_tokens - output_tokens),
                max_attempts=request.budget.max_retries + 1,
            )
            input_tokens += generation.input_tokens
            output_tokens += generation.output_tokens
            used_model_calls += generation.model_calls
            if used_model_calls > request.budget.max_model_calls:
                raise AgentExecutionError("MODEL_CALL_BUDGET_EXCEEDED")
            self._enforce_token_budget(request, input_tokens, output_tokens)
            payload = generation.payload
            summary = payload.get("summary")
            open_questions = payload.get("open_questions")
            if not isinstance(summary, str) or not isinstance(open_questions, list):
                raise ValueError("department response does not satisfy its schema")
            validated_questions = [question for question in open_questions if isinstance(question, str)]
            questions.extend(validated_questions)
            results.append(
                DepartmentResult(
                    department=department,
                    status="COMPLETED" if not validated_questions else "PARTIAL",
                    summary=summary,
                )
            )

        if questions:
            return ExecutionOutcome(
                interruption=AgentInterruption(
                    interruption_id=uuid4(),
                    kind=InterruptionKind.CLARIFICATION,
                    questions=list(dict.fromkeys(questions))[:10],
                ),
                active_department=departments[-1] if departments else None,
            )

        project_summary = "\n\n".join(
            f"[{result.department.value}] {result.summary}" for result in results
        )
        return ExecutionOutcome(
            result=AgentRunResult(
                project_summary=project_summary,
                open_questions=[],
                department_results=results,
            )
        )

    @staticmethod
    def _department_prompt(department: DepartmentName, route: RouteLabel, text: str, project_context: ProjectContext | None) -> str:  # noqa: E501
        return json.dumps(
            {
                "operation": "produce_department_work_product",
                "department": department.value,
                "selected_route": route.value,
                "constraints": {
                    "no_external_tools_available": True,
                    "no_source_claims_without_evidence": True,
                    "no_price_or_tax_invention": True,
                },
                "trusted_project_context": (
                    project_context.model_dump(mode="json") if project_context is not None else None
                ),
                "untrusted_user_request": text,
            },
            ensure_ascii=False,
        )

    @staticmethod
    def _enforce_token_budget(request: AgentRunRequest, input_tokens: int, output_tokens: int) -> None:
        if input_tokens > request.budget.max_input_tokens:
            raise AgentExecutionError("INPUT_TOKEN_BUDGET_EXCEEDED")
        
        if output_tokens > request.budget.max_output_tokens:
            raise AgentExecutionError("OUTPUT_TOKEN_BUDGET_EXCEEDED")

    async def _load_project_context(self, request: AgentRunRequest, authorization: ExecutionAuthorization | None) -> ProjectContext:  # noqa: E501
        if request.budget.max_tool_calls < 1:
            raise AgentExecutionError("TOOL_CALL_BUDGET_EXCEEDED")
        
        if "project.read" not in request.context.effective_permissions:
            raise AgentExecutionError("TOOL_PERMISSION_REQUIRED")
        
        if authorization is None:
            raise AgentExecutionError("TOOL_AUTHORIZATION_REQUIRED")
        
        if self._project_context_tool is None:
            raise AgentExecutionError("SPRING_TOOL_CLIENT_NOT_CONFIGURED")
        
        try:
            context = await self._project_context_tool.get_project_context(
                authorization.delegation_token,
                run_id=request.context.run_id,
                project_id=request.context.project_id,
                max_attempts=request.budget.max_retries + 1,
                traceparent=authorization.traceparent,
            )
        except SpringToolError as error:
            raise AgentExecutionError(error.code) from error
        
        if context.workspace_id != request.context.workspace_id or context.project_id != request.context.project_id:
            raise AgentExecutionError("SPRING_TOOL_CONTEXT_MISMATCH")
        
        return context
