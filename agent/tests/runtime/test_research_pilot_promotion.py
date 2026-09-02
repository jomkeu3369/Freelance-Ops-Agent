from __future__ import annotations

# ruff: noqa: E501, I001

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from runtime import IndependentPilotReview, PredictorEvaluationMetrics, ResearchPilotDrillEvidence, ResearchPilotPromotionEvidence, ResearchPilotPromotionGate, ResearchPilotPromotionPolicy, ResearchPilotPromotionStatus, ResearchPilotReadinessGate, ResearchPilotReadinessReport, RuntimeEvaluationReport, RuntimeGate, RuntimeOperationalSnapshot, RuntimeReleaseKind, RuntimeReleaseRecord, RuntimeReleaseStatus, SchedulerEvaluationMetrics, TaskAttemptEvaluationRecord, runtime_dataset_fingerprint


def runtime_records(count: int = 1_000) -> tuple[TaskAttemptEvaluationRecord, ...]:
    workspace_id = uuid4()
    start = datetime.now(UTC) - timedelta(days=7)
    return tuple(TaskAttemptEvaluationRecord(uuid4(), uuid4(), workspace_id, 1, 3, "research-read-v1", start + timedelta(seconds=index * 605), start + timedelta(seconds=index * 605 + 1), start + timedelta(seconds=index * 605 + 11), 10, "pilot-static-v1", True) for index in range(count))


def runtime_release(records: tuple[TaskAttemptEvaluationRecord, ...], status: RuntimeReleaseStatus = RuntimeReleaseStatus.APPROVED) -> RuntimeReleaseRecord:
    now = datetime.now(UTC)
    fingerprint = runtime_dataset_fingerprint(list(records)) if records else "b" * 64
    return RuntimeReleaseRecord(uuid4(), RuntimeReleaseKind.SCHEDULER_POLICY, "research-fifo-pilot-v1", "research-read-v1", "code://research-fifo-pilot-v1", "a" * 64, fingerprint, status, "runtime-promotion-v1", now, now if status is RuntimeReleaseStatus.APPROVED else None)


def runtime_report(status: RuntimeReleaseStatus = RuntimeReleaseStatus.APPROVED, *, record_count: int = 1_000, observation_days: float = 7) -> RuntimeEvaluationReport:
    scheduler = SchedulerEvaluationMetrics(1, 1, 1, 1, 1)
    return RuntimeEvaluationReport(status, "runtime-promotion-v1", record_count, observation_days, 3, 0, 1, 1, PredictorEvaluationMetrics(1, 1, 0, 0, 1), scheduler, scheduler, (RuntimeGate("all", status is RuntimeReleaseStatus.APPROVED, 1, "= 1"),))


def readiness_report() -> ResearchPilotReadinessReport:
    snapshot = RuntimeOperationalSnapshot("research-read-v1", datetime.now(UTC), 0, 0, 0, 0, 0, 0, 0, 0, 1)
    drills = ResearchPilotDrillEvidence(True, True, True, True, True, True, True, True, True, 0, 0, 1, 1, 1)
    return ResearchPilotReadinessGate().evaluate(snapshot, drills)


def review(commit_sha: str = "c" * 40) -> IndependentPilotReview:
    return IndependentPilotReview("release-author", "independent-reviewer", True, commit_sha, "https://github.example/review/1", datetime.now(UTC))


def evidence() -> ResearchPilotPromotionEvidence:
    records = runtime_records()
    return ResearchPilotPromotionEvidence(runtime_release(records), runtime_report(), records, readiness_report(), (records[0].workspace_id,), "research-read-v1", "research-read-v1", 1_000, 0, True, True, True, True, "sha256:" + "d" * 64, "backup://restore-drill/1", "load-test://k6/1", "https://github.example/actions/runs/1", "c" * 40, review())


def test_promotion_gate_grants_only_separate_release_review_eligibility() -> None:
    report = ResearchPilotPromotionGate().evaluate(evidence())

    assert report.status is ResearchPilotPromotionStatus.ELIGIBLE_FOR_SEPARATE_RELEASE_REVIEW
    assert report.reasons == ()


def test_promotion_gate_holds_when_required_operational_evidence_is_missing() -> None:
    selected = replace(evidence(), runtime_release=runtime_release((), RuntimeReleaseStatus.SHADOW_ONLY), runtime_report=runtime_report(RuntimeReleaseStatus.SHADOW_ONLY, record_count=0, observation_days=0), runtime_records=(), workspace_ids=(), read_only_terminal_attempt_count=0, provider_outage_drill_passed=False, immutable_image_rollback_passed=False, backup_restore_passed=False, network_load_test_passed=False, image_digest="", backup_evidence_reference="", load_test_evidence_reference="", ci_run_reference="", deployment_commit_sha="", independent_review=None)

    report = ResearchPilotPromotionGate().evaluate(selected)

    assert report.status is ResearchPilotPromotionStatus.HOLD
    assert {"RUNTIME_RELEASE_NOT_APPROVED", "RUNTIME_REPORT_NOT_APPROVED", "RUNTIME_DATASET_EMPTY", "TERMINAL_ATTEMPTS_INSUFFICIENT", "OBSERVATION_WINDOW_INSUFFICIENT", "WORKSPACE_SCOPE_EMPTY", "READ_ONLY_EVIDENCE_EMPTY", "PROVIDER_OUTAGE_DRILL_FAILED", "IMMUTABLE_IMAGE_ROLLBACK_FAILED", "BACKUP_RESTORE_DRILL_FAILED", "NETWORK_LOAD_TEST_FAILED", "IMMUTABLE_IMAGE_DIGEST_MISSING", "BACKUP_EVIDENCE_MISSING", "LOAD_TEST_EVIDENCE_MISSING", "DEPLOYMENT_EVIDENCE_INVALID", "INDEPENDENT_REVIEW_MISSING"} <= set(report.reasons)


def test_promotion_gate_rejects_self_review_and_commit_mismatch() -> None:
    selected = evidence()
    assert selected.independent_review is not None
    self_review = replace(selected.independent_review, reviewer="release-author", approved=False, reviewed_commit_sha="e" * 40)
    selected = replace(selected, independent_review=self_review)

    report = ResearchPilotPromotionGate().evaluate(selected)

    assert report.status is ResearchPilotPromotionStatus.HOLD
    assert set(report.reasons) == {"INDEPENDENT_REVIEW_REJECTED", "INDEPENDENT_REVIEWER_REQUIRED", "INDEPENDENT_REVIEW_COMMIT_MISMATCH"}


def test_promotion_scope_and_policy_reject_invalid_values() -> None:
    workspace_id = uuid4()
    with pytest.raises(ValueError, match="duplicates"):
        replace(evidence(), workspace_ids=(workspace_id, workspace_id))
    with pytest.raises(ValueError, match="promotion policy"):
        ResearchPilotPromotionPolicy(maximum_workspace_count=0)
