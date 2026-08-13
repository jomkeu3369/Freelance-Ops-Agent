"""Deterministic authority and side-effect checks that run before model routing."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum


@dataclass(frozen=True, slots=True)
class SafetyContext:
    """Trusted facts supplied by Spring, never inferred from user text."""

    external_side_effect: bool = False
    sensitive_data: bool = False
    financial_authority_required: bool = False
    legal_authority_required: bool = False
    irreversible_action: bool = False
    approval_required: bool = False
    authority_verified: bool = False

    def to_dict(self) -> dict[str, bool]:
        return asdict(self)


class SafetyDecisionCode(StrEnum):
    CONTINUE_TO_LLM = "CONTINUE_TO_LLM"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    SENSITIVE_DATA_REVIEW_REQUIRED = "SENSITIVE_DATA_REVIEW_REQUIRED"
    AUTHORITY_NOT_VERIFIED = "AUTHORITY_NOT_VERIFIED"


@dataclass(frozen=True, slots=True)
class SafetyDecision:
    requires_human: bool
    code: SafetyDecisionCode


def evaluate_safety(context: SafetyContext) -> SafetyDecision:
    if context.approval_required or context.irreversible_action:
        return SafetyDecision(True, SafetyDecisionCode.APPROVAL_REQUIRED)
    if context.sensitive_data and context.external_side_effect:
        return SafetyDecision(True, SafetyDecisionCode.SENSITIVE_DATA_REVIEW_REQUIRED)
    authority_is_required = (
        context.external_side_effect
        or context.financial_authority_required
        or context.legal_authority_required
    )
    if authority_is_required and not context.authority_verified:
        return SafetyDecision(True, SafetyDecisionCode.AUTHORITY_NOT_VERIFIED)
    return SafetyDecision(False, SafetyDecisionCode.CONTINUE_TO_LLM)
