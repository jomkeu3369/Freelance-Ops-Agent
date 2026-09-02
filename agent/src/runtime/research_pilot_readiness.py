"""Fail-closed readiness gate for the Research FIFO shadow pilot."""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .runtime_operational_metrics import RuntimeOperationalSnapshot


class ResearchPilotReadinessStatus(StrEnum):
    READY_FOR_LIMITED_PILOT = "READY_FOR_LIMITED_PILOT"
    ROLLBACK_REQUIRED = "ROLLBACK_REQUIRED"


@dataclass(frozen=True, slots=True)
class ResearchPilotDrillEvidence:
    restart_recovery_passed: bool
    checkpoint_resume_passed: bool
    cancel_fence_passed: bool
    redirect_fence_passed: bool
    ack_loss_recovery_passed: bool
    retry_budget_passed: bool
    provider_circuit_passed: bool
    rollback_drill_passed: bool
    fallback_preserved: bool
    duplicate_side_effect_count: int
    cross_workspace_violation_count: int
    scheduler_observation_coverage: float
    terminal_delivery_coverage: float
    retry_reason_coverage: float

    def __post_init__(self) -> None:
        counts = (self.duplicate_side_effect_count, self.cross_workspace_violation_count)
        coverages = (self.scheduler_observation_coverage, self.terminal_delivery_coverage, self.retry_reason_coverage)
        if any(value < 0 for value in counts) or any(not 0 <= value <= 1 for value in coverages):
            raise ValueError("Research pilot drill evidence is invalid")


@dataclass(frozen=True, slots=True)
class ResearchPilotReadinessPolicy:
    maximum_oldest_ready_age_seconds: float = 300
    minimum_scheduler_observation_coverage: float = 1
    minimum_terminal_delivery_coverage: float = 1
    minimum_retry_reason_coverage: float = 0.99

    def __post_init__(self) -> None:
        coverages = (self.minimum_scheduler_observation_coverage, self.minimum_terminal_delivery_coverage, self.minimum_retry_reason_coverage)
        if self.maximum_oldest_ready_age_seconds < 0 or any(not 0 <= value <= 1 for value in coverages):
            raise ValueError("Research pilot readiness policy is invalid")


@dataclass(frozen=True, slots=True)
class ResearchPilotReadinessReport:
    status: ResearchPilotReadinessStatus
    reasons: tuple[str, ...]
    snapshot: RuntimeOperationalSnapshot
    evidence: ResearchPilotDrillEvidence


class ResearchPilotReadinessGate:
    def __init__(self, policy: ResearchPilotReadinessPolicy | None = None) -> None:
        self._policy = policy or ResearchPilotReadinessPolicy()

    def evaluate(self, snapshot: RuntimeOperationalSnapshot, evidence: ResearchPilotDrillEvidence) -> ResearchPilotReadinessReport:
        reasons: list[str] = []
        drills = {
            "RESTART_RECOVERY_FAILED": evidence.restart_recovery_passed,
            "CHECKPOINT_RESUME_FAILED": evidence.checkpoint_resume_passed,
            "CANCEL_FENCE_FAILED": evidence.cancel_fence_passed,
            "REDIRECT_FENCE_FAILED": evidence.redirect_fence_passed,
            "ACK_LOSS_RECOVERY_FAILED": evidence.ack_loss_recovery_passed,
            "RETRY_BUDGET_DRILL_FAILED": evidence.retry_budget_passed,
            "PROVIDER_CIRCUIT_DRILL_FAILED": evidence.provider_circuit_passed,
            "ROLLBACK_DRILL_FAILED": evidence.rollback_drill_passed,
            "AGENT_RUN_FALLBACK_MISSING": evidence.fallback_preserved
        }
        reasons.extend(reason for reason, passed in drills.items() if not passed)
        if snapshot.expired_lease_count:
            reasons.append("EXPIRED_LEASE_REMAINS")
        if snapshot.dispatched_not_started_count:
            reasons.append("DISPATCHED_ATTEMPT_NOT_STARTED")
        if snapshot.queue_depth and snapshot.oldest_ready_age_seconds > self._policy.maximum_oldest_ready_age_seconds:
            reasons.append("READY_QUEUE_AGE_EXCEEDED")
        if evidence.duplicate_side_effect_count:
            reasons.append("DUPLICATE_SIDE_EFFECT_DETECTED")
        if evidence.cross_workspace_violation_count:
            reasons.append("CROSS_WORKSPACE_VIOLATION_DETECTED")
        if evidence.scheduler_observation_coverage < self._policy.minimum_scheduler_observation_coverage:
            reasons.append("SCHEDULER_OBSERVATION_COVERAGE_LOW")
        if evidence.terminal_delivery_coverage < self._policy.minimum_terminal_delivery_coverage:
            reasons.append("TERMINAL_DELIVERY_COVERAGE_LOW")
        if evidence.retry_reason_coverage < self._policy.minimum_retry_reason_coverage:
            reasons.append("RETRY_REASON_COVERAGE_LOW")
        status = ResearchPilotReadinessStatus.READY_FOR_LIMITED_PILOT if not reasons else ResearchPilotReadinessStatus.ROLLBACK_REQUIRED
        return ResearchPilotReadinessReport(status, tuple(reasons), snapshot, evidence)
