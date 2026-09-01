from __future__ import annotations

import pytest

from .hierarchical_retry_simulation import FailureMode, HierarchicalRetryConfig, RecoveryPolicy, build_hierarchical_retry_benchmark, generate_hierarchical_retry_rows, summarize_hierarchical_retry
from .scheduler_simulation import SchedulerTask, WorkerCapacityEvent
from .retry_checkpoint_simulation import RetryExperimentConfig, RetryStrategy, simulate_retry_strategy
from .tenant_fairness_simulation import TenantFairnessScenario


def test_hierarchical_retry_config_rejects_invalid_values() -> None:
    with pytest.raises(ValueError, match="probabilities"):
        HierarchicalRetryConfig(scale_success_probability=1.1)


def test_retry_simulator_applies_capacity_event_and_exposes_task_results() -> None:
    tasks = [SchedulerTask(task_id=f"task-{index}", workspace_id="workspace", queued_at_seconds=0.0, actual_runtime_seconds=20.0, predicted_runtime_seconds=20.0, priority=3) for index in range(4)]
    config = RetryExperimentConfig(worker_count=1, failure_probability=0.0)
    baseline = simulate_retry_strategy(tasks, RetryStrategy.CHECKPOINT_IMMEDIATE, seed=3, config=config)
    scaled = simulate_retry_strategy(tasks, RetryStrategy.CHECKPOINT_IMMEDIATE, seed=3, config=config, capacity_events=[WorkerCapacityEvent(at_seconds=10.0, worker_count=2)])
    assert scaled.metrics.makespan_seconds < baseline.metrics.makespan_seconds
    assert len(scaled.task_results) == len(tasks)
    assert scaled.capacity_events[0].worker_count == 2


def test_joint_rows_are_counterfactually_paired() -> None:
    success, failure = generate_hierarchical_retry_rows(seeds=[3], scenarios=[TenantFairnessScenario.NOISY_NEIGHBOR], failure_modes=[FailureMode.INDEPENDENT], policies=[RecoveryPolicy.FAILURE_AWARE])
    assert len(success) == len(failure) == 1
    assert success[0].scale_succeeded
    assert not failure[0].scale_succeeded
    assert (success[0].seed, success[0].scenario, success[0].failure_mode) == (failure[0].seed, failure[0].scenario, failure[0].failure_mode)


def test_checkpoint_reduces_independent_failure_waste_relative_to_restart() -> None:
    policies = [RecoveryPolicy.RESTART_BACKOFF_BUDGET, RecoveryPolicy.CHECKPOINT_IMMEDIATE]
    success, failure = generate_hierarchical_retry_rows(seeds=[3, 5], scenarios=[TenantFairnessScenario.ELEPHANT_AND_MICE], failure_modes=[FailureMode.INDEPENDENT], policies=policies)
    restart = summarize_hierarchical_retry(success, failure, RecoveryPolicy.RESTART_BACKOFF_BUDGET, 1.0)
    checkpoint = summarize_hierarchical_retry(success, failure, RecoveryPolicy.CHECKPOINT_IMMEDIATE, 1.0)
    assert checkpoint.wasted_useful_seconds.mean < restart.wasted_useful_seconds.mean


def test_failure_aware_policy_limits_outage_retry_burst() -> None:
    policies = [RecoveryPolicy.CHECKPOINT_IMMEDIATE, RecoveryPolicy.FAILURE_AWARE]
    success, failure = generate_hierarchical_retry_rows(seeds=[3, 5], scenarios=[TenantFairnessScenario.ELEPHANT_AND_MICE], failure_modes=[FailureMode.PROVIDER_OUTAGE], policies=policies)
    immediate = summarize_hierarchical_retry(success, failure, RecoveryPolicy.CHECKPOINT_IMMEDIATE, 1.0)
    adaptive = summarize_hierarchical_retry(success, failure, RecoveryPolicy.FAILURE_AWARE, 1.0)
    assert adaptive.peak_retry_release_count.mean <= immediate.peak_retry_release_count.mean


def test_joint_benchmark_only_selects_gate_eligible_policy() -> None:
    benchmark = build_hierarchical_retry_benchmark(seeds=[3, 5], scenarios=[TenantFairnessScenario.NOISY_NEIGHBOR, TenantFairnessScenario.ELEPHANT_AND_MICE])
    assert len(benchmark.summaries) == len(RecoveryPolicy)
    if benchmark.selected_policy is not None:
        selected = next(summary for summary in benchmark.summaries if summary.policy is benchmark.selected_policy)
        assert selected.expected_hard_gate_pass_rate >= 0.90
