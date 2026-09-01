from __future__ import annotations

import pytest

from .hierarchical_reliability_simulation import HierarchicalReliabilityConfig, HierarchicalReliabilityStrategy, build_expected_reliability_benchmark, generate_reliability_state_rows, required_scale_success_probability, summarize_expected_reliability
from .tenant_fairness_simulation import TenantFairnessScenario


def test_reliability_config_rejects_invalid_values() -> None:
    with pytest.raises(ValueError, match="scale_success_probability"):
        HierarchicalReliabilityConfig(scale_success_probability=1.1)
    with pytest.raises(ValueError, match="billing"):
        HierarchicalReliabilityConfig(minimum_scale_billing_seconds=-1.0)


def test_success_and_failure_rows_are_paired() -> None:
    strategies = (HierarchicalReliabilityStrategy.SCALE_ONLY, HierarchicalReliabilityStrategy.SCALE_THEN_HIERARCHICAL_FALLBACK)
    success, failure = generate_reliability_state_rows(seeds=(3, 5), scenarios=(TenantFairnessScenario.ELEPHANT_AND_MICE,), strategies=strategies)
    assert [(row.scenario, row.seed, row.strategy) for row in success] == [(row.scenario, row.seed, row.strategy) for row in failure]
    assert all(row.scale_succeeded for row in success)
    assert all(not row.scale_succeeded for row in failure)


def test_mixture_endpoints_equal_deterministic_states() -> None:
    strategy = HierarchicalReliabilityStrategy.SCALE_THEN_HIERARCHICAL_FALLBACK
    success, failure = generate_reliability_state_rows(seeds=(3, 5), scenarios=(TenantFairnessScenario.ELEPHANT_AND_MICE,), strategies=(strategy,))
    failure_summary = summarize_expected_reliability(success, failure, strategy, 0.0)
    success_summary = summarize_expected_reliability(success, failure, strategy, 1.0)
    assert failure_summary.completion_slo_goodput.mean == pytest.approx(sum(row.metrics.completion_slo_goodput for row in failure) / len(failure))
    assert success_summary.completion_slo_goodput.mean == pytest.approx(sum(row.metrics.completion_slo_goodput for row in success) / len(success))


def test_fallback_reduces_failure_tail_relative_to_scale_only() -> None:
    strategies = (HierarchicalReliabilityStrategy.SCALE_ONLY, HierarchicalReliabilityStrategy.SCALE_THEN_HIERARCHICAL_FALLBACK)
    success, failure = generate_reliability_state_rows(seeds=(11, 23), scenarios=(TenantFairnessScenario.ELEPHANT_AND_MICE,), strategies=strategies)
    scale_only = summarize_expected_reliability(success, failure, HierarchicalReliabilityStrategy.SCALE_ONLY, 0.0)
    fallback = summarize_expected_reliability(success, failure, HierarchicalReliabilityStrategy.SCALE_THEN_HIERARCHICAL_FALLBACK, 0.0)
    assert fallback.maximum_wait_seconds.mean < scale_only.maximum_wait_seconds.mean
    assert fallback.admitted_rate.mean < scale_only.admitted_rate.mean


def test_expected_benchmark_selects_only_gate_eligible_strategy() -> None:
    benchmark = build_expected_reliability_benchmark(seeds=(3, 5), scenarios=(TenantFairnessScenario.NOISY_NEIGHBOR, TenantFairnessScenario.ELEPHANT_AND_MICE))
    assert len(benchmark.summaries) == len(HierarchicalReliabilityStrategy)
    if benchmark.selected_strategy is not None:
        selected = next(summary for summary in benchmark.summaries if summary.strategy is benchmark.selected_strategy)
        assert selected.expected_hard_gate_pass_rate >= 0.90


def test_required_success_probability_is_bounded_or_unreachable() -> None:
    strategy = HierarchicalReliabilityStrategy.SCALE_THEN_HIERARCHICAL_FALLBACK
    success, failure = generate_reliability_state_rows(seeds=(3, 5), scenarios=(TenantFairnessScenario.ELEPHANT_AND_MICE,), strategies=(strategy,))
    required = required_scale_success_probability(success, failure, strategy, step=0.05)
    assert required is None or 0 <= required <= 1
