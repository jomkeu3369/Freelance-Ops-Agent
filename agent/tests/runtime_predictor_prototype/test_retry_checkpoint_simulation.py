from __future__ import annotations

from .retry_checkpoint_simulation import RetryExperimentConfig, RetryStrategy, run_retry_benchmark, simulate_retry_strategy
from .scheduler_simulation import SchedulerExperimentConfig, SchedulerTask


def _task(task_id: str, queued_at: float, runtime: float, *, priority: int = 3) -> SchedulerTask:
    return SchedulerTask(task_id=task_id, workspace_id="workspace", queued_at_seconds=queued_at, actual_runtime_seconds=runtime, predicted_runtime_seconds=runtime, priority=priority)


def test_no_failure_restart_has_no_demand_amplification() -> None:
    tasks = [_task(f"task-{index}", 0.0, 20.0) for index in range(4)]
    config = RetryExperimentConfig(worker_count=2, failure_probability=0.0)
    restart = simulate_retry_strategy(tasks, RetryStrategy.RESTART_IMMEDIATE, seed=3, config=config)
    checkpoint = simulate_retry_strategy(tasks, RetryStrategy.CHECKPOINT_IMMEDIATE, seed=3, config=config)
    assert restart.metrics.completion_rate == 1.0
    assert restart.metrics.demand_amplification == 1.0
    assert checkpoint.metrics.demand_amplification >= 1.0


def test_checkpoint_resume_reuses_progress_after_correlated_outage() -> None:
    tasks = [_task(f"task-{index}", 0.0, 100.0) for index in range(2)]
    config = RetryExperimentConfig(worker_count=2, failure_probability=0.0, max_attempts=2, checkpoint_interval_seconds=20.0, checkpoint_overhead_seconds=1.0, outage_at_seconds=55.0, outage_duration_seconds=0.0)
    restart = simulate_retry_strategy(tasks, RetryStrategy.RESTART_IMMEDIATE, seed=5, config=config)
    checkpoint = simulate_retry_strategy(tasks, RetryStrategy.CHECKPOINT_IMMEDIATE, seed=5, config=config)
    assert restart.metrics.completion_rate == 1.0
    assert checkpoint.metrics.completion_rate == 1.0
    assert checkpoint.metrics.service_demand_seconds < restart.metrics.service_demand_seconds
    assert checkpoint.metrics.p95_end_to_end_seconds < restart.metrics.p95_end_to_end_seconds
    assert checkpoint.metrics.checkpoint_saved_work_seconds > 0


def test_backoff_jitter_spreads_correlated_retry_releases() -> None:
    tasks = [_task(f"task-{index}", 0.0, 100.0) for index in range(12)]
    config = RetryExperimentConfig(worker_count=12, failure_probability=0.0, max_attempts=2, base_backoff_seconds=30.0, maximum_backoff_seconds=30.0, jitter_ratio=1.0, outage_at_seconds=10.0, outage_duration_seconds=0.0, retry_burst_window_seconds=5.0)
    immediate = simulate_retry_strategy(tasks, RetryStrategy.RESTART_IMMEDIATE, seed=7, config=config)
    backoff = simulate_retry_strategy(tasks, RetryStrategy.RESTART_BACKOFF, seed=7, config=config)
    assert immediate.metrics.peak_retry_release_count == 12
    assert backoff.metrics.peak_retry_release_count < immediate.metrics.peak_retry_release_count


def test_global_retry_budget_caps_retry_amplification() -> None:
    tasks = [_task(f"task-{index}", 0.0, 30.0) for index in range(10)]
    config = RetryExperimentConfig(worker_count=3, failure_probability=0.9, max_attempts=4, retry_budget_ratio=0.2)
    result = simulate_retry_strategy(tasks, RetryStrategy.RESTART_BACKOFF_BUDGET, seed=11, config=config)
    assert result.metrics.retry_count <= 2
    assert result.metrics.retry_budget_exhaustion_rate > 0


def test_retry_benchmark_returns_every_requested_strategy() -> None:
    scheduler = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=3.0, training_samples=200)
    strategies = (RetryStrategy.RESTART_IMMEDIATE, RetryStrategy.CHECKPOINT_BACKOFF)
    benchmark = run_retry_benchmark(scheduler, retry_config=RetryExperimentConfig(worker_count=2, failure_probability=0.1), strategies=strategies, seeds=(3, 5))
    assert len(benchmark.rows) == 4
    assert tuple(summary.strategy for summary in benchmark.summaries) == strategies
    assert benchmark.offered_load_ratio.mean > 0
