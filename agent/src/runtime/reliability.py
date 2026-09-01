"""Failure-aware checkpoint retry and provider circuit policy."""

# ruff: noqa: E501, I001

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
import hashlib
import secrets

from .task_contracts import FailureClassification, FailureSignals, RetryDecision, RetryDecisionSnapshot, RetryReason

FAILURE_CLASSIFIER_VERSION = "weighted-multi-signal-v1"
RETRY_BUCKET_POLICY_VERSION = "hierarchical-count-v1"


@dataclass(frozen=True, slots=True)
class FailureAssessment:
    classification: FailureClassification
    confidence: float
    score: int


class WeightedFailureClassifier:
    threshold = 4

    def classify(self, signals: FailureSignals) -> FailureAssessment:
        if signals.deterministic_error:
            return FailureAssessment(FailureClassification.DETERMINISTIC, 1.0, 0)
        score = 0
        score += 2 if signals.provider_error else 0
        score += 1 if signals.rate_limited else 0
        score += 2 if signals.affected_workspaces >= 3 else 0
        score += 1 if signals.affected_worker_ratio >= 0.30 else 0
        score += 2 if signals.provider_status_degraded else 0
        score -= 2 if signals.local_worker_error else 0
        score -= 1 if signals.tool_health_confirmed else 0
        score = max(0, score)
        if score >= self.threshold:
            return FailureAssessment(FailureClassification.CORRELATED_PROVIDER, min(1.0, 0.55 + score * 0.07), score)
        return FailureAssessment(FailureClassification.INDEPENDENT_TRANSIENT, min(0.95, 0.55 + (self.threshold - score) * 0.08), score)


@dataclass(frozen=True, slots=True)
class TokenBucketState:
    capacity: float
    tokens: float
    refill_per_second: float
    refilled_at: datetime

    def __post_init__(self) -> None:
        if self.capacity <= 0 or self.refill_per_second < 0 or not 0 <= self.tokens <= self.capacity:
            raise ValueError("retry token bucket state is invalid")
        if self.refilled_at.tzinfo is None or self.refilled_at.utcoffset() is None:
            raise ValueError("retry token bucket timestamp must be timezone-aware")

    def at(self, now: datetime) -> TokenBucketState:
        elapsed = max(0.0, (now - self.refilled_at).total_seconds())
        return TokenBucketState(self.capacity, min(self.capacity, self.tokens + elapsed * self.refill_per_second), self.refill_per_second, now)

    def consume(self, now: datetime) -> tuple[TokenBucketState, bool]:
        current = self.at(now)
        if current.tokens < 1:
            return current, False
        return TokenBucketState(current.capacity, current.tokens - 1, current.refill_per_second, now), True


class HierarchicalRetryBudget:
    def decide(self, assessment: FailureAssessment, workspace: TokenBucketState, global_bucket: TokenBucketState, *, attempt_number: int, max_attempts: int, now: datetime, backoff_seconds: float = 0) -> tuple[RetryDecisionSnapshot, TokenBucketState, TokenBucketState]:
        if attempt_number >= max_attempts:
            return self._deny(RetryReason.MAX_ATTEMPTS_REACHED, assessment, workspace.at(now), global_bucket.at(now)), workspace.at(now), global_bucket.at(now)
        if assessment.classification is FailureClassification.DETERMINISTIC:
            return self._deny(RetryReason.NON_RETRYABLE_FAILURE, assessment, workspace.at(now), global_bucket.at(now)), workspace.at(now), global_bucket.at(now)
        if assessment.classification is FailureClassification.CORRELATED_PROVIDER:
            return self._deny(RetryReason.CORRELATED_FAILURE_CIRCUIT_OPEN, assessment, workspace.at(now), global_bucket.at(now)), workspace.at(now), global_bucket.at(now)
        workspace_current = workspace.at(now)
        global_current = global_bucket.at(now)
        workspace_after, workspace_allowed = workspace_current.consume(now)
        if not workspace_allowed:
            return self._deny(RetryReason.WORKSPACE_BUCKET_EMPTY, assessment, workspace_current, global_current), workspace_current, global_current
        global_after, global_allowed = global_current.consume(now)
        if not global_allowed:
            return self._deny(RetryReason.GLOBAL_BUCKET_EMPTY, assessment, workspace_current, global_current), workspace_current, global_current
        ready_at = now + timedelta(seconds=max(0, backoff_seconds))
        snapshot = RetryDecisionSnapshot(decision=RetryDecision.ALLOW, reason=RetryReason.RETRY_ALLOWED, failure_classification=assessment.classification, classification_confidence=assessment.confidence, classifier_version=FAILURE_CLASSIFIER_VERSION, bucket_policy_version=RETRY_BUCKET_POLICY_VERSION, workspace_tokens_before=workspace_current.tokens, workspace_tokens_after=workspace_after.tokens, global_tokens_before=global_current.tokens, global_tokens_after=global_after.tokens, retry_ready_at=ready_at)
        return snapshot, workspace_after, global_after

    @staticmethod
    def _deny(reason: RetryReason, assessment: FailureAssessment, workspace: TokenBucketState, global_bucket: TokenBucketState) -> RetryDecisionSnapshot:
        return RetryDecisionSnapshot(decision=RetryDecision.DENY, reason=reason, failure_classification=assessment.classification, classification_confidence=assessment.confidence, classifier_version=FAILURE_CLASSIFIER_VERSION, bucket_policy_version=RETRY_BUCKET_POLICY_VERSION, workspace_tokens_before=workspace.tokens, workspace_tokens_after=workspace.tokens, global_tokens_before=global_bucket.tokens, global_tokens_after=global_bucket.tokens)


class CircuitState(StrEnum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


@dataclass(frozen=True, slots=True)
class ProviderCircuit:
    state: CircuitState = CircuitState.CLOSED
    opened_at: datetime | None = None
    probe_after: datetime | None = None


class ProviderCircuitPolicy:
    def __init__(self, recovery_seconds: int = 30) -> None:
        if recovery_seconds < 1:
            raise ValueError("circuit recovery seconds must be positive")
        self._recovery = timedelta(seconds=recovery_seconds)

    def observe(self, circuit: ProviderCircuit, assessment: FailureAssessment, now: datetime) -> ProviderCircuit:
        if assessment.classification is FailureClassification.CORRELATED_PROVIDER and assessment.confidence >= 0.6:
            return ProviderCircuit(CircuitState.OPEN, now, now + self._recovery)
        return circuit

    @staticmethod
    def begin_probe(circuit: ProviderCircuit, now: datetime) -> ProviderCircuit:
        if circuit.state is not CircuitState.OPEN or circuit.probe_after is None or now < circuit.probe_after:
            raise RuntimeError("provider circuit probe is not available")
        return ProviderCircuit(CircuitState.HALF_OPEN, circuit.opened_at, circuit.probe_after)

    def finish_probe(self, circuit: ProviderCircuit, *, success: bool, now: datetime) -> ProviderCircuit:
        if circuit.state is not CircuitState.HALF_OPEN:
            raise RuntimeError("provider circuit is not probing")
        return ProviderCircuit() if success else ProviderCircuit(CircuitState.OPEN, now, now + self._recovery)


def default_retry_buckets(now: datetime | None = None) -> tuple[TokenBucketState, TokenBucketState]:
    refilled_at = now or datetime.now(UTC)
    return TokenBucketState(12, 12, 0.10, refilled_at), TokenBucketState(16, 16, 0.10, refilled_at)


def issue_resume_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).hexdigest()


def verify_resume_token(token: str, expected_hash: str) -> bool:
    actual = hashlib.sha256(token.encode()).hexdigest()
    return secrets.compare_digest(actual, expected_hash)
