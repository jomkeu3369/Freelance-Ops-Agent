from __future__ import annotations

import pytest

from .retry_checkpoint_simulation import RetryBudgetScope, RetryExperimentConfig, RetryStrategy, simulate_retry_strategy
from .scheduler_simulation import SchedulerTask
from .tenant_fairness_simulation import TenantFairnessScenario
from .workspace_retry_budget_simulation import WorkspaceRetryBudgetConfig, build_workspace_retry_budget_benchmark, generate_workspace_retry_budget_rows, summarize_workspace_retry_budget


def test_workspace_retry_budget_config_rejects_invalid_values() -> None:
    with pytest.raises(ValueError, match="probabilities"):
        WorkspaceRetryBudgetConfig(noisy_failure_probability=1.1)
    with pytest.raises(ValueError, match="token bucket"):
        RetryExperimentConfig(workspace_retry_bucket_capacity=0.0)


def test_workspace_failure_probability_is_applied_without_affecting_healthy_workspace() -> None:
    tasks = [SchedulerTask(task_id="noisy", workspace_id="workspace-noisy", queued_at_seconds=0.0, actual_runtime_seconds=20.0, predicted_runtime_seconds=20.0, priority=3), SchedulerTask(task_id="healthy", workspace_id="workspace-healthy", queued_at_seconds=0.0, actual_runtime_seconds=20.0, predicted_runtime_seconds=20.0, priority=3)]
    failure_probabilities = tuple([("workspace-noisy", 1.0)])
    config = RetryExperimentConfig(worker_count=2, failure_probability=0.0, failure_probability_by_workspace=failure_probabilities, retry_budget_scope=RetryBudgetScope.WORKSPACE_TOKEN_BUCKET, workspace_retry_bucket_capacity=1.0, workspace_retry_refill_tokens_per_second=0.0, max_attempts=3)
    result = simulate_retry_strategy(tasks, RetryStrategy.CHECKPOINT_BACKOFF_BUDGET, seed=3, config=config)
    by_id = {task.task_id: task for task in result.task_results}
    assert by_id["healthy"].status == "completed"
    assert by_id["noisy"].status == "failed"
    assert by_id["noisy"].retry_budget_exhausted


def test_hierarchical_budget_rows_are_counterfactually_paired() -> None:
    success, failure = generate_workspace_retry_budget_rows(seeds=[3], scenarios=[TenantFairnessScenario.NOISY_NEIGHBOR], scopes=[RetryBudgetScope.HIERARCHICAL_TOKEN_BUCKET])
    assert len(success) == len(failure) == 1
    assert success[0].scale_succeeded
    assert not failure[0].scale_succeeded
    assert (success[0].seed, success[0].scenario, success[0].scope) == (failure[0].seed, failure[0].scenario, failure[0].scope)


def test_workspace_bucket_protects_healthy_retry_budget_from_noisy_workspace() -> None:
    scopes = [RetryBudgetScope.GLOBAL, RetryBudgetScope.HIERARCHICAL_TOKEN_BUCKET]
    success, failure = generate_workspace_retry_budget_rows(seeds=[3, 5], scenarios=[TenantFairnessScenario.NOISY_NEIGHBOR], scopes=scopes)
    global_summary = summarize_workspace_retry_budget(success, failure, RetryBudgetScope.GLOBAL, 1.0)
    hierarchical_summary = summarize_workspace_retry_budget(success, failure, RetryBudgetScope.HIERARCHICAL_TOKEN_BUCKET, 1.0)
    assert hierarchical_summary.healthy_retry_budget_exhaustion_rate.mean <= global_summary.healthy_retry_budget_exhaustion_rate.mean


def test_benchmark_only_selects_gate_eligible_scope() -> None:
    benchmark = build_workspace_retry_budget_benchmark(seeds=[3, 5], scenarios=[TenantFairnessScenario.NOISY_NEIGHBOR, TenantFairnessScenario.ELEPHANT_AND_MICE])
    assert len(benchmark.summaries) == len(RetryBudgetScope)
    if benchmark.selected_scope is not None:
        selected = next(summary for summary in benchmark.summaries if summary.scope is benchmark.selected_scope)
        assert selected.expected_gate_pass_rate >= 0.90
