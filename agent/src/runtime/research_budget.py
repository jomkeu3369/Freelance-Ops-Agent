"""Single-pass pilot budgets: immutable allocations, no refund of uncertain spending."""

# ruff: noqa: E501, I001

from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert

from contracts import AgentRunRequest, AgentRunUsage, RunBudget
from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentResearchBudgetModel

from .research_input import research_input_digest
from .task_contracts import DepartmentTask


class ResearchBudgetConflict(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ResearchBudgetAllocation:
    primary: AgentRunRequest
    shadow: AgentRunRequest | None


def split_research_budget(request: AgentRunRequest) -> ResearchBudgetAllocation:
    budget = request.budget
    if budget.max_model_calls < 5 or budget.max_tool_calls < 3 or budget.max_search_credits < 1 or budget.max_input_tokens < 4 or budget.max_output_tokens < 4:
        return ResearchBudgetAllocation(request, None)
    shadow_values = budget.model_dump()
    shared = ("max_model_calls", "max_tool_calls", "max_input_tokens", "max_output_tokens", "max_search_credits", "max_retries", "max_handoffs")
    for name in shared:
        shadow_values[name] = getattr(budget, name) // 4
    shadow_values.update(max_model_calls=max(2, shadow_values["max_model_calls"]), max_tool_calls=max(2, shadow_values["max_tool_calls"]), max_search_credits=max(1, shadow_values["max_search_credits"]), max_departments=1, max_hierarchy_depth=1, max_retries=0, max_handoffs=0)
    shadow = RunBudget.model_validate(shadow_values)
    primary_values = budget.model_dump()
    for name in shared:
        primary_values[name] -= getattr(shadow, name)
    # Duration is a wall-clock limit and depth/departments are structural, not consumable credits.
    primary = RunBudget.model_validate(primary_values)
    return ResearchBudgetAllocation(request.model_copy(update={"budget": primary}), request.model_copy(update={"budget": shadow}))


class PostgresResearchBudgetLedger:
    def __init__(self, database: PgVectorConnectionManager, workspace_ids: Collection[UUID]) -> None:
        self._database = database
        self._workspaces = frozenset(workspace_ids)

    def applies(self, request: AgentRunRequest) -> bool:
        return request.context.workspace_id in self._workspaces

    async def reserve(self, request: AgentRunRequest) -> ResearchBudgetAllocation:
        allocation = split_research_budget(request)
        async with self._database.session() as session:
            statement = insert(AgentResearchBudgetModel).values(run_id=request.context.run_id, workspace_id=request.context.workspace_id, input_sha256=research_input_digest(request), original_json=request.budget.model_dump(mode="json"), primary_json=allocation.primary.budget.model_dump(mode="json"), shadow_json=None if allocation.shadow is None else allocation.shadow.budget.model_dump(mode="json"), primary_status="RESERVED", shadow_status="DISABLED" if allocation.shadow is None else "RESERVED", created_at=datetime.now(UTC)).on_conflict_do_nothing().returning(AgentResearchBudgetModel.run_id)
            if await session.scalar(statement) is None:
                raise ResearchBudgetConflict("PILOT_RUN_BUDGET_ALREADY_RESERVED")
        return allocation

    async def settle_primary(self, run_id: UUID, usage: AgentRunUsage | None) -> None:
        async with self._database.session() as session:
            record = await session.get(AgentResearchBudgetModel, run_id, with_for_update=True)
            if record is None or record.primary_status != "RESERVED":
                raise ResearchBudgetConflict("PILOT_RUN_RESERVATION_MISSING")
            record.primary_status = "UNKNOWN" if usage is None else "COMPLETED"
            record.primary_usage_json = None if usage is None else usage.model_dump(mode="json")

    async def require_shadow(self, task: DepartmentTask, request: AgentRunRequest) -> None:
        async with self._database.session() as session:
            record = await session.get(AgentResearchBudgetModel, task.run_id)
            if record is None or record.workspace_id != task.workspace_id or record.input_sha256 != research_input_digest(request) or record.shadow_json != task.execution.budget.model_dump(mode="json"):
                raise ResearchBudgetConflict("PILOT_SHADOW_RESERVATION_MISMATCH")
