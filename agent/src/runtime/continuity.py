"""Fail-closed execution continuity rules, independent of credentials and billing."""

from datetime import datetime, timedelta

from contracts import AgentRunRequest, AgentRunStatus, AgentRunUsage

TERMINAL_RUN_STATUSES = frozenset({
    AgentRunStatus.COMPLETED, AgentRunStatus.PARTIAL, AgentRunStatus.FAILED, AgentRunStatus.CANCELLED,
})
INTERRUPTED_RUN_ERROR = "RUN_EXECUTION_INTERRUPTED"
# This is a detection grace after the existing execution limit, not extra
# permission to make provider calls. It leaves time for timeout cancellation
# and the final database write before another process reconciles the run.
INTERRUPTED_RUN_GRACE_SECONDS = 30


def execution_is_stalled(request: AgentRunRequest, started_at: datetime, now: datetime) -> bool:
    deadline = started_at + timedelta(seconds=request.budget.max_duration_seconds)
    if request.byok_budget is not None:
        deadline = min(deadline, request.byok_budget.valid_until)
    elif request.platform_budget is not None and request.platform_budget.completion is None:
        deadline = min(deadline, request.platform_budget.valid_until)
    return now >= deadline + timedelta(seconds=INTERRUPTED_RUN_GRACE_SECONDS)


def introduces_terminal_attempt(current: AgentRunUsage | None, incoming: AgentRunUsage) -> bool:
    """Permit late settlement of known calls, but never admit another paid call."""
    known = {call.call_id for call in current.provider_calls} if current is not None else set()
    return any(call.call_id not in known for call in incoming.provider_calls)
