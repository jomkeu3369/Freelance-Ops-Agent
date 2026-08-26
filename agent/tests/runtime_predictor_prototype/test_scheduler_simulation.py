from __future__ import annotations

import math

import pytest

from .scheduler_simulation import SchedulerExperimentConfig, SchedulerTask, SchedulingPolicy, generate_scheduler_workload, run_policy_comparison, run_scheduler_benchmark, simulate_scheduler


def _task(task_id: str, workspace_id: str, runtime: float, predicted: float, *, queued_at: float = 0.0, priority: int = 3, cache_hit: bool = False) -> SchedulerTask:
    return SchedulerTask(task_id=task_id, workspace_id=workspace_id, queued_at_seconds=queued_at, actual_runtime_seconds=runtime, predicted_runtime_seconds=predicted, priority=priority, cache_hit=cache_hit)


def test_scheduler_task_rejects_invalid_values() -> None:
    with pytest.raises(ValueError, match="runtime values"):
        _task("invalid", "workspace", 0.0, 1.0)
    with pytest.raises(ValueError, match="priority"):
        _task("invalid", "workspace", 1.0, 1.0, priority=6)


def test_fifo_preserves_arrival_order_on_one_worker() -> None:
    tasks = [_task("first", "workspace", 4.0, 4.0), _task("second", "workspace", 1.0, 1.0), _task("third", "workspace", 2.0, 2.0)]
    result = simulate_scheduler(tasks, SchedulingPolicy.FIFO, worker_count=1)
    by_start = sorted(result.task_results, key=lambda task: task.started_at_seconds)
    assert [task.task_id for task in by_start] == ["first", "second", "third"]


def test_predicted_sjf_reduces_mean_completion_for_accurate_predictions() -> None:
    tasks = [_task("long", "workspace", 10.0, 10.0), _task("short-1", "workspace", 1.0, 1.0), _task("short-2", "workspace", 1.0, 1.0)]
    fifo = simulate_scheduler(tasks, SchedulingPolicy.FAIR_FIFO, worker_count=1)
    predicted = simulate_scheduler(tasks, SchedulingPolicy.FAIR_PREDICTED_SJF, worker_count=1)
    assert predicted.metrics.mean_completion_seconds < fifo.metrics.mean_completion_seconds
    assert sorted(predicted.task_results, key=lambda task: task.started_at_seconds)[0].task_id == "short-1"


def test_workspace_fairness_prevents_one_workspace_from_monopolizing_dispatch() -> None:
    tasks = [_task(f"a-{index}", "workspace-a", 2.0, 2.0) for index in range(6)]
    tasks.append(_task("b-1", "workspace-b", 2.0, 2.0))
    fifo = simulate_scheduler(tasks, SchedulingPolicy.FIFO, worker_count=1)
    fair = simulate_scheduler(tasks, SchedulingPolicy.FAIR_FIFO, worker_count=1)
    fifo_b = next(task for task in fifo.task_results if task.task_id == "b-1")
    fair_b = next(task for task in fair.task_results if task.task_id == "b-1")
    assert fair_b.started_at_seconds < fifo_b.started_at_seconds
    assert fair_b.started_at_seconds <= 2.0


def test_aging_dispatches_long_task_after_maximum_wait() -> None:
    tasks = [_task("long", "workspace", 8.0, 100.0)]
    tasks.extend(_task(f"short-{index}", "workspace", 1.0, 1.0, queued_at=index * 0.9) for index in range(12))
    result = simulate_scheduler(tasks, SchedulingPolicy.FAIR_PREDICTED_SJF_AGING, worker_count=1, max_wait_seconds=3.0, aging_rate=0.05)
    long_result = next(task for task in result.task_results if task.task_id == "long")
    assert 3.0 <= long_result.started_at_seconds <= 4.0


def test_cache_hit_completes_without_consuming_worker_capacity() -> None:
    tasks = [_task("cached", "workspace", 100.0, 100.0, cache_hit=True), _task("worker", "workspace", 5.0, 5.0)]
    result = simulate_scheduler(tasks, SchedulingPolicy.FIFO, worker_count=1)
    cached = next(task for task in result.task_results if task.task_id == "cached")
    worker = next(task for task in result.task_results if task.task_id == "worker")
    assert cached.queue_wait_seconds == 0.0
    assert cached.completed_at_seconds < worker.completed_at_seconds
    assert worker.started_at_seconds == 0.0
    assert result.metrics.cache_hit_count == 1


def test_oracle_is_the_lower_bound_for_mean_completion_in_single_workspace() -> None:
    tasks = [_task("one", "workspace", 9.0, 1.0), _task("two", "workspace", 2.0, 12.0), _task("three", "workspace", 4.0, 3.0)]
    comparison = run_policy_comparison(tasks, worker_count=1)
    oracle = comparison[SchedulingPolicy.ORACLE_SJF]
    for result in comparison.values():
        assert result.metrics.mean_completion_seconds >= oracle.metrics.mean_completion_seconds
        assert result.metrics.scheduler_regret_percent >= -1e-9


def test_generated_workload_is_reproducible_and_prediction_metrics_are_finite() -> None:
    config = SchedulerExperimentConfig(workspace_count=3, tasks_per_workspace=10, worker_count=2, training_samples=300)
    first, first_metrics = generate_scheduler_workload(config, random_seed=7)
    second, second_metrics = generate_scheduler_workload(config, random_seed=7)
    assert first == second
    assert first_metrics == second_metrics
    assert len(first) == 30
    assert all(math.isfinite(value) for value in first_metrics)


def test_multi_seed_benchmark_returns_every_policy_and_confidence_interval() -> None:
    config = SchedulerExperimentConfig(workspace_count=3, tasks_per_workspace=12, worker_count=3, mean_interarrival_seconds=4.0, max_wait_seconds=40.0, training_samples=300)
    benchmark = run_scheduler_benchmark(config, seeds=(3, 5))
    assert len(benchmark.rows) == len(SchedulingPolicy) * 2
    assert {summary.policy for summary in benchmark.summaries} == set(SchedulingPolicy)
    assert benchmark.prediction_mae_seconds.mean > 0
    assert benchmark.prediction_rmse_seconds.mean >= benchmark.prediction_mae_seconds.mean
    assert benchmark.offered_load_ratio.mean > 0
    assert all(summary.mean_wait_seconds.ci95 >= 0 for summary in benchmark.summaries)


def test_overloaded_arrivals_increase_queue_wait() -> None:
    low_load = [_task(f"low-{index}", "workspace", 2.0, 2.0, queued_at=index * 3.0) for index in range(10)]
    high_load = [_task(f"high-{index}", "workspace", 2.0, 2.0, queued_at=index * 0.5) for index in range(10)]
    low_result = simulate_scheduler(low_load, SchedulingPolicy.FAIR_PREDICTED_SJF_AGING, worker_count=1, max_wait_seconds=10.0)
    high_result = simulate_scheduler(high_load, SchedulingPolicy.FAIR_PREDICTED_SJF_AGING, worker_count=1, max_wait_seconds=10.0)
    assert high_result.metrics.mean_wait_seconds > low_result.metrics.mean_wait_seconds


def test_global_predicted_sjf_does_not_apply_workspace_fairness() -> None:
    tasks = [_task("a-short", "workspace-a", 1.0, 1.0), _task("a-medium", "workspace-a", 2.0, 2.0), _task("b-long", "workspace-b", 4.0, 4.0)]
    global_result = simulate_scheduler(tasks, SchedulingPolicy.GLOBAL_PREDICTED_SJF, worker_count=1)
    fair_result = simulate_scheduler(tasks, SchedulingPolicy.FAIR_PREDICTED_SJF, worker_count=1)
    global_order = [task.task_id for task in sorted(global_result.task_results, key=lambda task: task.started_at_seconds)]
    fair_order = [task.task_id for task in sorted(fair_result.task_results, key=lambda task: task.started_at_seconds)]
    assert global_order == ["a-short", "a-medium", "b-long"]
    assert fair_order == ["a-short", "b-long", "a-medium"]
