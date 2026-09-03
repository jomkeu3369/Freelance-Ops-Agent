# ruff: noqa: E501, I001

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from contracts import AgentInput, AgentRunRequest, AgentRunResult, ModelSelection, Provider, RunBudget, SafetyContextInput, TrustedRunContext, AgentRunUsage
from runtime.research_budget import split_research_budget, ResearchBudgetConflict
from runtime.executor import OperationalAgentExecutor
from runtime.runs import AgentExecutionError, ExecutionOutcome


def request(**changes):
    values = dict(max_duration_seconds=60, max_model_calls=12, max_tool_calls=8, max_input_tokens=10000, max_output_tokens=4000, max_search_credits=2, max_departments=4, max_hierarchy_depth=2)
    values.update(changes)
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="budget", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"])
    return AgentRunRequest(context=context, input=AgentInput(requirement_text="research"), budget=RunBudget(**values), model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput())


@pytest.mark.parametrize("calls", [5, 8, 12, 50])
def test_consumable_allocations_never_exceed_parent(calls):
    original = request(max_model_calls=calls)
    allocation = split_research_budget(original)
    assert allocation.shadow is not None
    for field in ("max_model_calls", "max_tool_calls", "max_input_tokens", "max_output_tokens", "max_search_credits", "max_retries", "max_handoffs"):
        assert getattr(allocation.primary.budget, field) + getattr(allocation.shadow.budget, field) == getattr(original.budget, field)
    assert allocation.shadow.budget.max_retries == 0
    assert original.budget.max_model_calls == calls


@pytest.mark.parametrize("changes", [{"max_model_calls": 4}, {"max_tool_calls": 2}, {"max_search_credits": 0}, {"max_input_tokens": 0}, {"max_output_tokens": 0}])
def test_insufficient_parent_disables_shadow_without_expanding_primary(changes):
    original = request(**changes)
    allocation = split_research_budget(original)
    assert allocation.primary == original and allocation.shadow is None


async def test_executor_reserves_before_routing_and_passes_separate_budgets():
    original = request()
    allocation = split_research_budget(original)
    ledger = SimpleNamespace(applies=Mock(return_value=True), reserve=AsyncMock(return_value=allocation), settle_primary=AsyncMock())
    executor = OperationalAgentExecutor(Mock(), Mock(), research_budget_ledger=ledger)
    outcome = ExecutionOutcome(result=AgentRunResult(project_summary="done"), usage=AgentRunUsage(request_tier="SINGLE_AGENT", model_calls=1, tool_calls=0, input_tokens=10, output_tokens=10, duration_ms=1))
    executor._execute = AsyncMock(return_value=outcome)
    assert await executor.execute(original) == outcome
    executor._execute.assert_awaited_once_with(allocation.primary, None, None, isolated=True, shadow_request=allocation.shadow)
    ledger.settle_primary.assert_awaited_once_with(original.context.run_id, outcome.usage)


async def test_uncertain_primary_failure_keeps_reservation_and_no_fake_zero_usage():
    original = request()
    ledger = SimpleNamespace(applies=Mock(return_value=True), reserve=AsyncMock(return_value=split_research_budget(original)), settle_primary=AsyncMock())
    executor = OperationalAgentExecutor(Mock(), Mock(), research_budget_ledger=ledger)
    executor._execute = AsyncMock(side_effect=RuntimeError("provider lost"))
    with pytest.raises(RuntimeError):
        await executor.execute(original)
    ledger.settle_primary.assert_awaited_once_with(original.context.run_id, None)


async def test_repeated_run_is_rejected_before_routing_or_tool_work():
    original = request()
    ledger = SimpleNamespace(applies=Mock(return_value=True), reserve=AsyncMock(side_effect=ResearchBudgetConflict("PILOT_RUN_BUDGET_ALREADY_RESERVED")), settle_primary=AsyncMock())
    executor = OperationalAgentExecutor(Mock(), Mock(), research_budget_ledger=ledger)
    executor._execute = AsyncMock()
    with pytest.raises(AgentExecutionError, match="ALREADY_RESERVED"):
        await executor.execute(original)
    executor._execute.assert_not_awaited()
    ledger.settle_primary.assert_not_awaited()
