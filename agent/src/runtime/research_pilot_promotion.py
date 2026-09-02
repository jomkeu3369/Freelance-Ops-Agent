"""Final evidence gate for a limited Research FIFO pilot."""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from .research_pilot_readiness import ResearchPilotReadinessReport, ResearchPilotReadinessStatus
from .runtime_evaluation import RuntimeEvaluationReport, RuntimeReleaseStatus, TaskAttemptEvaluationRecord
from .runtime_evaluation_store import RuntimeReleaseKind, RuntimeReleaseRecord, runtime_dataset_fingerprint


class ResearchPilotPromotionStatus(StrEnum):
    HOLD = "HOLD"
    ELIGIBLE_FOR_SEPARATE_RELEASE_REVIEW = "ELIGIBLE_FOR_SEPARATE_RELEASE_REVIEW"


@dataclass(frozen=True, slots=True)
class IndependentPilotReview:
    author: str
    reviewer: str
    approved: bool
    reviewed_commit_sha: str
    review_reference: str
    reviewed_at: datetime

    def __post_init__(self) -> None:
        if any(not value.strip() for value in (self.author, self.reviewer, self.reviewed_commit_sha, self.review_reference)):
            raise ValueError("Independent pilot review identity is invalid")
        if self.reviewed_at.tzinfo is None or self.reviewed_at.utcoffset() is None:
            raise ValueError("Independent pilot review time must be timezone-aware")


@dataclass(frozen=True, slots=True)
class ResearchPilotPromotionEvidence:
    runtime_release: RuntimeReleaseRecord
    runtime_report: RuntimeEvaluationReport
    runtime_records: tuple[TaskAttemptEvaluationRecord, ...]
    readiness_report: ResearchPilotReadinessReport
    workspace_ids: tuple[UUID, ...]
    resource_pool: str
    specialist_profile: str
    read_only_terminal_attempt_count: int
    write_capable_terminal_attempt_count: int
    provider_outage_drill_passed: bool
    immutable_image_rollback_passed: bool
    backup_restore_passed: bool
    network_load_test_passed: bool
    image_digest: str
    backup_evidence_reference: str
    load_test_evidence_reference: str
    ci_run_reference: str
    deployment_commit_sha: str
    independent_review: IndependentPilotReview | None

    def __post_init__(self) -> None:
        counts = (self.read_only_terminal_attempt_count, self.write_capable_terminal_attempt_count)
        if any(value < 0 for value in counts):
            raise ValueError("Research pilot promotion counts are invalid")
        if len(set(self.workspace_ids)) != len(self.workspace_ids):
            raise ValueError("Research pilot workspace scope contains duplicates")


@dataclass(frozen=True, slots=True)
class ResearchPilotPromotionPolicy:
    minimum_terminal_attempts: int = 1_000
    minimum_observation_days: float = 7
    maximum_workspace_count: int = 5
    required_resource_pool: str = "research-read-v1"
    required_specialist_profile: str = "research-read-v1"

    def __post_init__(self) -> None:
        if self.minimum_terminal_attempts < 1 or self.minimum_observation_days <= 0 or self.maximum_workspace_count < 1 or not self.required_resource_pool.strip() or not self.required_specialist_profile.strip():
            raise ValueError("Research pilot promotion policy is invalid")


@dataclass(frozen=True, slots=True)
class ResearchPilotPromotionReport:
    status: ResearchPilotPromotionStatus
    reasons: tuple[str, ...]
    evidence: ResearchPilotPromotionEvidence


class ResearchPilotPromotionGate:
    def __init__(self, policy: ResearchPilotPromotionPolicy | None = None) -> None:
        self._policy = policy or ResearchPilotPromotionPolicy()

    def evaluate(self, evidence: ResearchPilotPromotionEvidence) -> ResearchPilotPromotionReport:
        reasons: list[str] = []
        release = evidence.runtime_release
        runtime_report = evidence.runtime_report
        records = evidence.runtime_records
        review = evidence.independent_review
        if release.release_kind is not RuntimeReleaseKind.SCHEDULER_POLICY or release.status is not RuntimeReleaseStatus.APPROVED or release.approved_at is None:
            reasons.append("RUNTIME_RELEASE_NOT_APPROVED")
        if runtime_report.status is not RuntimeReleaseStatus.APPROVED or any(not gate.passed for gate in runtime_report.gates):
            reasons.append("RUNTIME_REPORT_NOT_APPROVED")
        if release.policy_version != runtime_report.policy_version:
            reasons.append("RUNTIME_REPORT_POLICY_MISMATCH")
        if release.resource_pool != evidence.resource_pool:
            reasons.append("RUNTIME_RELEASE_SCOPE_MISMATCH")
        if not records:
            reasons.append("RUNTIME_DATASET_EMPTY")
        else:
            if len(records) != runtime_report.record_count or runtime_dataset_fingerprint(list(records)) != release.dataset_fingerprint:
                reasons.append("RUNTIME_DATASET_MISMATCH")
            if {record.workspace_id for record in records} != set(evidence.workspace_ids):
                reasons.append("RUNTIME_WORKSPACE_SCOPE_MISMATCH")
            if any(record.resource_pool != evidence.resource_pool for record in records):
                reasons.append("RUNTIME_RESOURCE_POOL_MISMATCH")
        if evidence.readiness_report.status is not ResearchPilotReadinessStatus.READY_FOR_LIMITED_PILOT:
            reasons.append("RECOVERY_READINESS_NOT_APPROVED")
        if runtime_report.record_count < self._policy.minimum_terminal_attempts:
            reasons.append("TERMINAL_ATTEMPTS_INSUFFICIENT")
        if runtime_report.observation_days < self._policy.minimum_observation_days:
            reasons.append("OBSERVATION_WINDOW_INSUFFICIENT")
        if not evidence.workspace_ids:
            reasons.append("WORKSPACE_SCOPE_EMPTY")
        elif len(evidence.workspace_ids) > self._policy.maximum_workspace_count:
            reasons.append("WORKSPACE_SCOPE_TOO_WIDE")
        if evidence.resource_pool != self._policy.required_resource_pool or evidence.specialist_profile != self._policy.required_specialist_profile:
            reasons.append("RESEARCH_PROFILE_NOT_ALLOWED")
        if evidence.read_only_terminal_attempt_count < 1:
            reasons.append("READ_ONLY_EVIDENCE_EMPTY")
        if evidence.write_capable_terminal_attempt_count:
            reasons.append("WRITE_CAPABLE_TASK_DETECTED")
        if evidence.read_only_terminal_attempt_count + evidence.write_capable_terminal_attempt_count != runtime_report.record_count:
            reasons.append("TASK_SCOPE_COVERAGE_MISMATCH")
        drills = {
            "PROVIDER_OUTAGE_DRILL_FAILED": evidence.provider_outage_drill_passed,
            "IMMUTABLE_IMAGE_ROLLBACK_FAILED": evidence.immutable_image_rollback_passed,
            "BACKUP_RESTORE_DRILL_FAILED": evidence.backup_restore_passed,
            "NETWORK_LOAD_TEST_FAILED": evidence.network_load_test_passed
        }
        reasons.extend(reason for reason, passed in drills.items() if not passed)
        if not _image_digest(evidence.image_digest):
            reasons.append("IMMUTABLE_IMAGE_DIGEST_MISSING")
        if not evidence.backup_evidence_reference.strip():
            reasons.append("BACKUP_EVIDENCE_MISSING")
        if not evidence.load_test_evidence_reference.strip():
            reasons.append("LOAD_TEST_EVIDENCE_MISSING")
        if not evidence.ci_run_reference.strip() or not _commit_sha(evidence.deployment_commit_sha):
            reasons.append("DEPLOYMENT_EVIDENCE_INVALID")
        if review is None:
            reasons.append("INDEPENDENT_REVIEW_MISSING")
        else:
            if not review.approved:
                reasons.append("INDEPENDENT_REVIEW_REJECTED")
            if review.author.casefold() == review.reviewer.casefold():
                reasons.append("INDEPENDENT_REVIEWER_REQUIRED")
            if review.reviewed_commit_sha != evidence.deployment_commit_sha:
                reasons.append("INDEPENDENT_REVIEW_COMMIT_MISMATCH")
            if review.reviewed_at < release.created_at:
                reasons.append("INDEPENDENT_REVIEW_PRECEDES_EVIDENCE")
        status = ResearchPilotPromotionStatus.ELIGIBLE_FOR_SEPARATE_RELEASE_REVIEW if not reasons else ResearchPilotPromotionStatus.HOLD
        return ResearchPilotPromotionReport(status, tuple(reasons), evidence)


def _commit_sha(value: str) -> bool:
    return len(value) == 40 and all(character in "0123456789abcdef" for character in value)


def _image_digest(value: str) -> bool:
    return value.startswith("sha256:") and len(value) == 71 and all(character in "0123456789abcdef" for character in value[7:])
