"""Default-off Research engine selection. Live Deep Agents admission is not ready.

Deliberately not wired into main: the current platform helper admits text-only
Responses calls with tools=[], not a native tool-calling harness. Do not turn a
fixture result into permission to bypass that boundary.
"""

from dataclasses import dataclass

from platform_budget import PlatformBudgetError

from .research_worker import ResearchExecution

DEEP_RESEARCH_RELEASE_GATES = (
    "native_tool_payload_admission",
    "paid_research_tool_admission",
    "durable_attempt_ledger_and_resume",
    "cancellation_and_revision_revalidation",
    "authorized_live_provider_validation",
)


@dataclass(frozen=True, slots=True)
class ResearchEnginePolicy:
    deep_agent_enabled: bool = False


def select_research_execution(
    baseline: ResearchExecution, policy: ResearchEnginePolicy | None = None,
) -> ResearchExecution:
    """Keep the admitted baseline; enabling an unadmitted engine fails closed."""
    if policy is not None and policy.deep_agent_enabled:
        raise PlatformBudgetError("PLATFORM_DEEP_RESEARCH_NOT_ADMITTED")
    return baseline
