from __future__ import annotations

# ruff: noqa: E501, I001

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from runtime import ResearchPilotDrillEvidence, ResearchPilotReadinessGate, ResearchPilotReadinessPolicy, ResearchPilotReadinessStatus, RuntimeOperationalSnapshot


def snapshot() -> RuntimeOperationalSnapshot:
    return RuntimeOperationalSnapshot("research-read-v1", datetime.now(UTC), 0, 0, 0, 0, 0, 0, 0, 0, 0)


def evidence() -> ResearchPilotDrillEvidence:
    return ResearchPilotDrillEvidence(True, True, True, True, True, True, True, True, True, 0, 0, 1, 1, 1)


def test_research_pilot_gate_allows_limited_pilot_only_with_complete_evidence() -> None:
    report = ResearchPilotReadinessGate().evaluate(snapshot(), evidence())

    assert report.status is ResearchPilotReadinessStatus.READY_FOR_LIMITED_PILOT
    assert report.reasons == ()


def test_research_pilot_gate_requires_rollback_for_recovery_and_observation_gaps() -> None:
    operational = replace(snapshot(), expired_lease_count=1, dispatched_not_started_count=1)
    drills = replace(evidence(), ack_loss_recovery_passed=False, fallback_preserved=False, duplicate_side_effect_count=1, terminal_delivery_coverage=0.9)

    report = ResearchPilotReadinessGate().evaluate(operational, drills)

    assert report.status is ResearchPilotReadinessStatus.ROLLBACK_REQUIRED
    assert set(report.reasons) == {"ACK_LOSS_RECOVERY_FAILED", "AGENT_RUN_FALLBACK_MISSING", "EXPIRED_LEASE_REMAINS", "DISPATCHED_ATTEMPT_NOT_STARTED", "DUPLICATE_SIDE_EFFECT_DETECTED", "TERMINAL_DELIVERY_COVERAGE_LOW"}


def test_research_pilot_gate_rejects_old_ready_queue_and_incomplete_coverage() -> None:
    operational = replace(snapshot(), queue_depth=1, oldest_ready_age_seconds=31)
    drills = replace(evidence(), scheduler_observation_coverage=0.99, retry_reason_coverage=0.98)
    policy = ResearchPilotReadinessPolicy(maximum_oldest_ready_age_seconds=30)

    report = ResearchPilotReadinessGate(policy).evaluate(operational, drills)

    assert report.status is ResearchPilotReadinessStatus.ROLLBACK_REQUIRED
    assert set(report.reasons) == {"READY_QUEUE_AGE_EXCEEDED", "SCHEDULER_OBSERVATION_COVERAGE_LOW", "RETRY_REASON_COVERAGE_LOW"}


def test_research_pilot_evidence_and_policy_reject_invalid_metrics() -> None:
    with pytest.raises(ValueError, match="drill evidence"):
        replace(evidence(), terminal_delivery_coverage=1.1)
    with pytest.raises(ValueError, match="readiness policy"):
        ResearchPilotReadinessPolicy(maximum_oldest_ready_age_seconds=-1)
