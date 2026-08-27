from __future__ import annotations

from .autoscaling_simulation import AutoscalingConfig, AutoscalingStrategy, detect_overload_at, run_autoscaling_benchmark, simulate_autoscaling_strategy
from .overload_simulation import AdmissionConfig
from .scheduler_simulation import SchedulerExperimentConfig, SchedulerTask


def _task(task_id: str, queued_at: float, runtime: float, *, priority: int = 3) -> SchedulerTask:
    return SchedulerTask(task_id=task_id, workspace_id="workspace", queued_at_seconds=queued_at, actual_runtime_seconds=runtime, predicted_runtime_seconds=runtime, priority=priority)


def test_overload_detection_uses_predicted_backlog_drain_time() -> None:
    tasks = [_task("one", 0.0, 10.0), _task("two", 1.0, 10.0), _task("three", 2.0, 10.0)]
    assert detect_overload_at(tasks, 1, 15.0) == 1.0
    assert detect_overload_at(tasks, 3, 15.0) is None


def test_predictive_scale_improves_completion_with_higher_peak_capacity() -> None:
    tasks = [_task(f"task-{index}", 0.0, 10.0) for index in range(8)]
    admission = AdmissionConfig(max_active_drain_seconds=10.0, emergency_drain_seconds=40.0, completion_slo_seconds=30.0)
    static = simulate_autoscaling_strategy(tasks, AutoscalingStrategy.STATIC_ACCEPT_ALL, seed=7, worker_count=1, admission_config=admission, autoscaling_config=AutoscalingConfig(trigger_drain_seconds=10.0, scale_up_delay_seconds=5.0, scale_factor=2.0))
    scaled = simulate_autoscaling_strategy(tasks, AutoscalingStrategy.PREDICTIVE_SCALE, seed=7, worker_count=1, admission_config=admission, autoscaling_config=AutoscalingConfig(trigger_drain_seconds=10.0, scale_up_delay_seconds=5.0, scale_factor=2.0))
    assert scaled.metrics.p95_end_to_end_seconds < static.metrics.p95_end_to_end_seconds
    assert scaled.scaled_worker_count > static.scaled_worker_count
    assert scaled.metrics.worker_capacity_seconds == static.metrics.worker_capacity_seconds


def test_shed_then_scale_preserves_high_priority_under_overload() -> None:
    tasks = [_task(f"low-{index}", 0.0, 10.0, priority=1) for index in range(8)]
    tasks.append(_task("high", 0.0, 10.0, priority=5))
    result = simulate_autoscaling_strategy(tasks, AutoscalingStrategy.SHED_THEN_SCALE, seed=3, worker_count=1, admission_config=AdmissionConfig(max_active_drain_seconds=10.0, emergency_drain_seconds=40.0), autoscaling_config=AutoscalingConfig(trigger_drain_seconds=10.0, scale_up_delay_seconds=5.0, scale_factor=2.0))
    assert result.metrics.high_priority_acceptance_rate == 1.0
    assert result.metrics.low_priority_acceptance_rate < 1.0
    assert result.scale_effective_at_seconds is not None


def test_autoscaling_benchmark_returns_requested_strategies() -> None:
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=2.0, training_samples=200)
    strategies = (AutoscalingStrategy.STATIC_ACCEPT_ALL, AutoscalingStrategy.REACTIVE_SCALE)
    benchmark = run_autoscaling_benchmark(config, strategies=strategies, seeds=(3, 5))
    assert len(benchmark.rows) == 4
    assert tuple(summary.strategy for summary in benchmark.summaries) == strategies
    assert benchmark.offered_load_ratio.mean > 0
