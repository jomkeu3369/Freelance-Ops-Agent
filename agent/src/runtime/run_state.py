"""실행 메타데이터와 확인 답변, 사용량의 집계."""

from __future__ import annotations

from builtin_skills import resolve_skills
from contracts import (
    AgentInterruption,
    AgentRunMetadata,
    AgentRunRequest,
    AgentRunUsage,
    ClarificationAnswer,
    RequestTier,
    ResumeAgentRunRequest,
)
from platform_budget import PlatformBudgetError


def run_metadata(request: AgentRunRequest, prompt_version: str = "department-work-product-v3-personal-pets") -> AgentRunMetadata:  # noqa: E501
    selected_skill_ids, deferred_skill_ids = resolve_skills(
        request.input.requirement_text, request.input.skill_selection
    )
    return AgentRunMetadata(
        skill_selection=request.input.skill_selection,
        resolved_skill_ids=selected_skill_ids,
        deferred_skill_ids=deferred_skill_ids,
        pet_profiles=request.input.pet_profiles,
        credential_id=request.model_selection.credential_id,
        provider=request.model_selection.provider,
        model=request.model_selection.model,
        prompt_version=prompt_version,
        tool_schema_version="spring-tool-api-v0.3.0",
        trace_id=request.context.trace_id
    )


def append_clarification_history(request: AgentRunRequest, interruption: AgentInterruption, command: ResumeAgentRunRequest) -> AgentRunRequest:  # noqa: E501
    additions = [
        ClarificationAnswer(question=interruption.questions[answer.question_index], answer=answer.answer)
        for answer in sorted(command.answers, key=lambda item: item.question_index)
    ]
    return request.model_copy(update={"clarification_history": [*request.clarification_history, *additions]})


def merge_usage(current: AgentRunUsage | None, incoming: AgentRunUsage | None) -> AgentRunUsage | None:
    if incoming is None:
        return current
    if current is None:
        return incoming
    if (
        current.platform_reservation_id is not None
        and incoming.platform_reservation_id is not None
        and current.platform_reservation_id != incoming.platform_reservation_id
    ):
        raise PlatformBudgetError("PLATFORM_RESERVATION_MISMATCH")
    if (
        current.tariff_version is not None
        and incoming.tariff_version is not None
        and current.tariff_version != incoming.tariff_version
    ):
        raise PlatformBudgetError("PLATFORM_TARIFF_MISMATCH")
    if (
        current.byok_scope_id is not None
        and incoming.byok_scope_id is not None
        and current.byok_scope_id != incoming.byok_scope_id
    ):
        raise PlatformBudgetError("BYOK_SCOPE_MISMATCH")
    if (current.byok_scope_id or incoming.byok_scope_id) and (
        current.platform_reservation_id or incoming.platform_reservation_id
    ):
        raise PlatformBudgetError("BYOK_FUNDING_MISMATCH")
    # 사용자 응답 대기 상태를 저장한 뒤 기록에 실패하면 같은 구간을 다시 보고할 수 있다.
    # 시도 ID로 중복된 비용 정산을 방지한다.
    calls = {call.call_id: call for call in current.provider_calls}
    for call in incoming.provider_calls:
        prior = calls.get(call.call_id)
        if prior is not None:
            if (prior.provider, prior.model, prior.funding_source, prior.reserved_cost_usd) != (
                call.provider,
                call.model,
                call.funding_source,
                call.reserved_cost_usd,
            ):
                raise PlatformBudgetError("PLATFORM_ATTEMPT_MISMATCH")
            # 호출 전의 오래된 상태로 확정된 사용량을 덮어쓰지 않는다.
            if prior.usage_known:
                if call.usage_known and call != prior:
                    raise PlatformBudgetError("PLATFORM_ATTEMPT_MISMATCH")
                continue
        calls[call.call_id] = call
    external = {call.call_id: call for call in current.external_tool_calls}
    for tool in incoming.external_tool_calls:
        prior_tool = external.get(tool.call_id)
        if tool.call_id in calls:
            raise PlatformBudgetError("PLATFORM_ATTEMPT_MISMATCH")
        if prior_tool is not None:
            if prior_tool.model_dump(exclude={"usage_known"}) != tool.model_dump(exclude={"usage_known"}):
                raise PlatformBudgetError("PLATFORM_ATTEMPT_MISMATCH")
            if prior_tool.usage_known:
                continue
        external[tool.call_id] = tool
    protected = any(
        value is not None
        for value in (
            current.platform_reservation_id,
            incoming.platform_reservation_id,
            current.byok_scope_id,
            incoming.byok_scope_id,
        )
    )
    tier_order = {
        RequestTier.DIRECT_TOOL: 0,
        RequestTier.SINGLE_AGENT: 1,
        RequestTier.DEPARTMENT: 2,
        RequestTier.MULTI_DEPARTMENT: 3,
        RequestTier.HUMAN_REQUIRED: 4,
    }
    request_tier = max((current.request_tier, incoming.request_tier), key=tier_order.__getitem__)
    return AgentRunUsage(
        request_tier=request_tier,
        model_calls=len(calls) if protected else current.model_calls + incoming.model_calls,
        tool_calls=current.tool_calls + incoming.tool_calls,
        input_tokens=sum(call.input_tokens for call in calls.values())
        if protected
        else current.input_tokens + incoming.input_tokens,
        output_tokens=sum(call.output_tokens for call in calls.values())
        if protected
        else current.output_tokens + incoming.output_tokens,
        cached_tokens=sum(call.cached_read_tokens for call in calls.values())
        if protected
        else current.cached_tokens + incoming.cached_tokens,
        search_credits=sum(call.credits for call in external.values()) if external else current.search_credits + incoming.search_credits,  # noqa: E501
        crawled_pages=current.crawled_pages + incoming.crawled_pages,
        retry_count=current.retry_count + incoming.retry_count,
        duration_ms=current.duration_ms + incoming.duration_ms,
        provider_calls=list(calls.values()),
        external_tool_calls=list(external.values()),
        platform_cost_usd=(sum((call.cost_usd for call in calls.values()), current.platform_cost_usd * 0)
                           + sum((tool.cost_usd for tool in external.values()), current.platform_cost_usd * 0))
        if protected
        else current.platform_cost_usd + incoming.platform_cost_usd,
        platform_reservation_id=incoming.platform_reservation_id or current.platform_reservation_id,
        tariff_version=incoming.tariff_version or current.tariff_version,
        byok_scope_id=incoming.byok_scope_id or current.byok_scope_id,
        execution_closed=current.execution_closed or incoming.execution_closed,
        unpriced_exposure=current.unpriced_exposure or incoming.unpriced_exposure
    )
