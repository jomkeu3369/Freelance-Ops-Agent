from __future__ import annotations

# ruff: noqa: E501, I001

from datetime import UTC, datetime, timedelta

import pytest

from runtime import FailureClassification, FailureSignals, HierarchicalRetryBudget, ProviderCircuit, ProviderCircuitPolicy, RetryDecision, RetryReason, TokenBucketState, WeightedFailureClassifier, default_retry_buckets, issue_resume_token, verify_resume_token
from runtime.reliability import CircuitState


def test_weighted_classifier_requires_correlated_multi_signal_evidence() -> None:
    classifier = WeightedFailureClassifier()

    local = classifier.classify(FailureSignals(provider_error=True, local_worker_error=True))
    correlated = classifier.classify(FailureSignals(provider_error=True, rate_limited=True,
        affected_workspaces=4, affected_worker_ratio=0.5, provider_status_degraded=True))
    deterministic = classifier.classify(FailureSignals(deterministic_error=True, affected_workspaces=5))

    assert local.classification is FailureClassification.INDEPENDENT_TRANSIENT
    assert correlated.classification is FailureClassification.CORRELATED_PROVIDER
    assert correlated.score >= classifier.threshold
    assert deterministic.classification is FailureClassification.DETERMINISTIC


def test_hierarchical_retry_consumes_both_buckets_only_when_allowed() -> None:
    now = datetime.now(UTC)
    workspace, global_bucket = default_retry_buckets(now)
    assessment = WeightedFailureClassifier().classify(FailureSignals(provider_error=True))

    allowed, workspace_after, global_after = HierarchicalRetryBudget().decide(assessment, workspace,
        global_bucket, attempt_number=1, max_attempts=3, now=now)

    assert allowed.decision is RetryDecision.ALLOW
    assert allowed.reason is RetryReason.RETRY_ALLOWED
    assert workspace_after.tokens == workspace.tokens - 1
    assert global_after.tokens == global_bucket.tokens - 1

    empty_global = TokenBucketState(16, 0, 0, now)
    denied, unchanged_workspace, unchanged_global = HierarchicalRetryBudget().decide(assessment, workspace,
        empty_global, attempt_number=1, max_attempts=3, now=now)

    assert denied.reason is RetryReason.GLOBAL_BUCKET_EMPTY
    assert unchanged_workspace.tokens == workspace.tokens
    assert unchanged_global.tokens == 0


def test_correlated_failure_opens_circuit_until_a_successful_probe() -> None:
    now = datetime.now(UTC)
    policy = ProviderCircuitPolicy(recovery_seconds=20)
    assessment = WeightedFailureClassifier().classify(FailureSignals(provider_error=True,
        affected_workspaces=3, affected_worker_ratio=0.5, provider_status_degraded=True))

    opened = policy.observe(ProviderCircuit(), assessment, now)

    assert opened.state is CircuitState.OPEN
    with pytest.raises(RuntimeError, match="not available"):
        policy.begin_probe(opened, now + timedelta(seconds=19))
    probing = policy.begin_probe(opened, now + timedelta(seconds=20))
    assert probing.state is CircuitState.HALF_OPEN
    assert policy.finish_probe(probing, success=True, now=now + timedelta(seconds=21)).state is CircuitState.CLOSED


def test_retry_bucket_refills_and_resume_token_is_verified_by_hash() -> None:
    now = datetime.now(UTC)
    bucket = TokenBucketState(12, 0, 0.10, now)

    assert bucket.at(now + timedelta(seconds=10)).tokens == pytest.approx(1.0)
    token, token_hash = issue_resume_token()
    assert verify_resume_token(token, token_hash)
    assert not verify_resume_token(token + "changed", token_hash)
