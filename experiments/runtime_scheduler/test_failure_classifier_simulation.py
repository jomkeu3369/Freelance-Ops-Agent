from __future__ import annotations

import pytest

from .failure_classifier_simulation import FailureClassifierConfig, revalue_secondary_provider, run_failure_classifier_experiment
from .hierarchical_retry_simulation import FailureMode, HierarchicalRetryConfig, RecoveryPolicy, generate_hierarchical_retry_rows
from .tenant_fairness_simulation import TenantFairnessScenario


def test_classifier_config_rejects_invalid_error_rate() -> None:
    with pytest.raises(ValueError, match="error rates"):
        FailureClassifierConfig(false_negative_rate=1.1)


def test_zero_classifier_error_preserves_failure_aware_gate() -> None:
    summary = run_failure_classifier_experiment(classifier_config=FailureClassifierConfig(false_positive_rate=0.0, false_negative_rate=0.0), seeds=[3, 5], scenarios=[TenantFairnessScenario.NOISY_NEIGHBOR])
    assert summary.false_failover_rate == 0.0
    assert summary.missed_outage_rate == 0.0
    assert all(rate >= 0 for _, rate in summary.hard_gate_pass_by_mode)


def test_false_negative_reduces_outage_gate() -> None:
    perfect = run_failure_classifier_experiment(classifier_config=FailureClassifierConfig(false_positive_rate=0.0, false_negative_rate=0.0), seeds=[3, 5], scenarios=[TenantFairnessScenario.NOISY_NEIGHBOR])
    missed = run_failure_classifier_experiment(classifier_config=FailureClassifierConfig(false_positive_rate=0.0, false_negative_rate=0.5), seeds=[3, 5], scenarios=[TenantFairnessScenario.NOISY_NEIGHBOR])
    perfect_outage = dict(perfect.hard_gate_pass_by_mode)[FailureMode.PROVIDER_OUTAGE]
    missed_outage = dict(missed.hard_gate_pass_by_mode)[FailureMode.PROVIDER_OUTAGE]
    assert missed_outage < perfect_outage


def test_secondary_provider_penalty_is_visible_in_quality_and_cost() -> None:
    retry = HierarchicalRetryConfig(secondary_provider_latency_multiplier=1.2, secondary_provider_cost_multiplier=1.5, secondary_provider_quality_failure_rate=0.05)
    summary = run_failure_classifier_experiment(retry_config=retry, seeds=[3, 5], scenarios=[TenantFairnessScenario.ELEPHANT_AND_MICE])
    assert summary.quality_adjusted_completion_goodput.mean <= summary.completion_slo_goodput.mean
    assert summary.secondary_provider_service_share.mean > 0
    assert summary.provider_cost_index.mean > summary.demand_amplification.mean


def test_secondary_provider_rows_can_be_revalued_without_replaying_execution() -> None:
    success, _ = generate_hierarchical_retry_rows(seeds=[3], scenarios=[TenantFairnessScenario.NOISY_NEIGHBOR], policies=[RecoveryPolicy.FAILURE_AWARE])
    adjusted = revalue_secondary_provider(success, quality_failure_rate=0.10, cost_multiplier=2.0)
    assert adjusted[0].metrics.quality_adjusted_completion_goodput <= success[0].metrics.completion_slo_goodput
    assert adjusted[0].metrics.provider_cost_index >= success[0].metrics.demand_amplification
