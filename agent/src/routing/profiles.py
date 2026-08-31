"""Deterministic execution profiles derived after semantic and safety routing."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .hybrid import RouteLabel
from .safety import SafetyContext


class ExecutionRisk(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    RESTRICTED = "RESTRICTED"


class ToolProfile(StrEnum):
    NONE = "NONE"
    READ_ONLY = "READ_ONLY"
    BOUNDED_WRITE = "BOUNDED_WRITE"


@dataclass(frozen=True, slots=True)
class RouteExecutionProfile:
    route: RouteLabel
    risk: ExecutionRisk
    model_profile: str
    tool_profile: ToolProfile
    policy_version: str = "route-profile-v1"


def execution_profile(route: RouteLabel, safety: SafetyContext) -> RouteExecutionProfile:
    if route is RouteLabel.HUMAN_REQUIRED:
        return RouteExecutionProfile(route, ExecutionRisk.RESTRICTED, "human-required", ToolProfile.NONE)
    if safety.irreversible_action or safety.approval_required:
        return RouteExecutionProfile(route, ExecutionRisk.RESTRICTED, "human-required", ToolProfile.NONE)
    if (
        safety.external_side_effect
        or safety.sensitive_data
        or safety.financial_authority_required
        or safety.legal_authority_required
    ):
        risk = ExecutionRisk.HIGH
    elif route in {RouteLabel.REACT_AGENT, RouteLabel.SUPERVISOR}:
        risk = ExecutionRisk.MEDIUM
    else:
        risk = ExecutionRisk.LOW
    model_profile = {
        RouteLabel.DIRECT_TOOL: "direct-tool-v1",
        RouteLabel.SIMPLE_LLM: "simple-llm-v1",
        RouteLabel.REACT_AGENT: "react-read-v1",
        RouteLabel.SUPERVISOR: "supervisor-v1",
    }[route]
    tool_profile = ToolProfile.NONE if route is RouteLabel.SIMPLE_LLM else ToolProfile.READ_ONLY
    return RouteExecutionProfile(route, risk, model_profile, tool_profile)
