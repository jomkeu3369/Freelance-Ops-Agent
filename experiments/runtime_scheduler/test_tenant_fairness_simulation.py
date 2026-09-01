from __future__ import annotations

import pytest

from .scheduler_simulation import SchedulingPolicy
from .tenant_fairness_simulation import TENANT_FAIRNESS_POLICIES, TenantFairnessConfig, TenantFairnessScenario, generate_tenant_fairness_workload, run_tenant_fairness_benchmark


def test_tenant_fairness_workloads_are_reproducible_and_scenario_specific() -> None:
    for scenario in TenantFairnessScenario:
        first = generate_tenant_fairness_workload(scenario, seed=17)
        second = generate_tenant_fairness_workload(scenario, seed=17)
        assert first == second
        assert len(first) >= 175
        assert len({task.workspace_id for task in first}) >= 3
    assert generate_tenant_fairness_workload(TenantFairnessScenario.NOISY_NEIGHBOR, seed=17) != generate_tenant_fairness_workload(TenantFairnessScenario.ELEPHANT_AND_MICE, seed=17)


def test_tenant_fairness_config_rejects_invalid_values() -> None:
    with pytest.raises(ValueError, match="worker_count"):
        TenantFairnessConfig(worker_count=0)
    with pytest.raises(ValueError, match="stress window"):
        TenantFairnessConfig(stress_window_start_seconds=10.0, stress_window_end_seconds=5.0)
    with pytest.raises(ValueError, match="reserved"):
        TenantFairnessConfig(worker_count=2, high_priority_reserved_workers=2)


def test_tenant_fairness_benchmark_covers_every_pair() -> None:
    benchmark = run_tenant_fairness_benchmark(seeds=(3, 5))
    assert len(benchmark.rows) == len(TenantFairnessScenario) * len(TENANT_FAIRNESS_POLICIES) * 2
    assert len(benchmark.summaries) == len(TENANT_FAIRNESS_POLICIES)
    assert {summary.policy for summary in benchmark.summaries} == set(TENANT_FAIRNESS_POLICIES)
    assert all(0 <= summary.gate_pass_rate <= 1 for summary in benchmark.summaries)
    assert all(0 <= summary.completion_slo_rate.mean <= 1 for summary in benchmark.summaries)


def test_bounded_fair_candidate_limits_stress_window_share_error() -> None:
    benchmark = run_tenant_fairness_benchmark(seeds=(11, 23, 37))
    legacy = next(summary for summary in benchmark.summaries if summary.policy is SchedulingPolicy.FAIR_PREDICTED_SJF_AGING)
    bounded = next(summary for summary in benchmark.summaries if summary.policy is SchedulingPolicy.BOUNDED_FAIR_PREDICTED_SJF_AGING)
    assert bounded.stress_service_share_error.mean < legacy.stress_service_share_error.mean
