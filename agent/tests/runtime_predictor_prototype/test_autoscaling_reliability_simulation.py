from __future__ import annotations

from .autoscaling_reliability_simulation import ScalingReliabilityConfig, ScalingReliabilityStrategy, generate_reliability_workloads, mix_scaling_reliability_benchmarks, run_scaling_reliability_benchmark, simulate_scaling_reliability_strategy
from .overload_simulation import AdmissionConfig
from .scheduler_simulation import SchedulerExperimentConfig, SchedulerTask


def _task(task_id: str, queued_at: float, runtime: float, *, priority: int = 3) -> SchedulerTask:
    return SchedulerTask(task_id=task_id, workspace_id="workspace", queued_at_seconds=queued_at, actual_runtime_seconds=runtime, predicted_runtime_seconds=runtime, priority=priority)


def test_failed_scale_activates_fallback_only_after_hard_deadline() -> None:
    tasks = [_task(f"low-{index}", float(index * 5), 30.0, priority=1) for index in range(20)]
    tasks.append(_task("high", 80.0, 10.0, priority=5))
    admission = AdmissionConfig(max_active_drain_seconds=10.0, emergency_drain_seconds=300.0, completion_slo_seconds=120.0)
    reliability = ScalingReliabilityConfig(trigger_drain_seconds=10.0, scale_up_delay_seconds=5.0, scale_hard_deadline_seconds=20.0, scale_success_probability=0.0)
    scale_only = simulate_scaling_reliability_strategy(tasks, ScalingReliabilityStrategy.SCALE_ONLY, seed=3, worker_count=1, admission_config=admission, reliability_config=reliability)
    fallback = simulate_scaling_reliability_strategy(tasks, ScalingReliabilityStrategy.SCALE_THEN_FALLBACK_SHED, seed=3, worker_count=1, admission_config=admission, reliability_config=reliability)
    assert fallback.fallback_activated_at_seconds is not None
    assert fallback.metrics.rejected_rate > 0
    assert fallback.metrics.high_priority_acceptance_rate == 1.0
    assert fallback.metrics.p95_end_to_end_seconds < scale_only.metrics.p95_end_to_end_seconds


def test_successful_scale_does_not_activate_fallback() -> None:
    tasks = [_task(f"task-{index}", float(index), 20.0) for index in range(12)]
    reliability = ScalingReliabilityConfig(trigger_drain_seconds=10.0, scale_up_delay_seconds=5.0, scale_hard_deadline_seconds=20.0, scale_success_probability=1.0, minimum_scale_billing_seconds=100.0)
    result = simulate_scaling_reliability_strategy(tasks, ScalingReliabilityStrategy.SCALE_THEN_FALLBACK_SHED, seed=7, worker_count=1, reliability_config=reliability)
    assert result.scale_succeeded
    assert result.scale_effective_at_seconds is not None
    assert result.fallback_activated_at_seconds is None
    assert result.scale_down_at_seconds is not None
    assert result.peak_worker_count == 2


def test_minimum_billing_is_included_after_work_finishes() -> None:
    tasks = [_task(f"task-{index}", 0.0, 5.0) for index in range(6)]
    reliability = ScalingReliabilityConfig(trigger_drain_seconds=5.0, scale_up_delay_seconds=0.0, scale_hard_deadline_seconds=10.0, scale_success_probability=1.0, scale_down_cooldown_seconds=0.0, minimum_scale_billing_seconds=120.0, worker_hour_cost=0.18)
    result = simulate_scaling_reliability_strategy(tasks, ScalingReliabilityStrategy.SCALE_ONLY, seed=5, worker_count=1, reliability_config=reliability)
    assert result.scale_effective_at_seconds is not None
    assert result.scale_down_at_seconds == result.scale_effective_at_seconds + 120.0
    assert result.billed_worker_seconds >= 240.0
    assert result.estimated_worker_cost == result.billed_worker_seconds * 0.18 / 3_600


def test_scale_down_timer_expires_before_a_later_arrival_gap() -> None:
    tasks = [_task("overload", 0.0, 100.0), _task("later", 200.0, 10.0)]
    reliability = ScalingReliabilityConfig(trigger_drain_seconds=10.0, scale_up_delay_seconds=0.0, scale_hard_deadline_seconds=10.0, scale_success_probability=1.0, scale_down_cooldown_seconds=60.0, minimum_scale_billing_seconds=0.0)
    result = simulate_scaling_reliability_strategy(tasks, ScalingReliabilityStrategy.SCALE_ONLY, seed=5, worker_count=1, reliability_config=reliability)
    assert result.scale_effective_at_seconds == 0.0
    assert result.scale_down_at_seconds == 60.0
    assert result.scale_down_at_seconds < tasks[-1].queued_at_seconds


def test_reliability_benchmark_reuses_paired_workloads() -> None:
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=2.0, training_samples=200)
    seeds = (3, 5)
    workloads = generate_reliability_workloads(config, seeds)
    strategies = (ScalingReliabilityStrategy.SCALE_ONLY, ScalingReliabilityStrategy.SCALE_THEN_FALLBACK_SHED)
    benchmark = run_scaling_reliability_benchmark(config, reliability_config=ScalingReliabilityConfig(scale_success_probability=0.5), strategies=strategies, seeds=seeds, workloads=workloads)
    assert len(benchmark.rows) == 4
    assert tuple(summary.strategy for summary in benchmark.summaries) == strategies
    assert benchmark.offered_load_ratio.mean > 0


def test_counterfactual_mixture_uses_exact_success_probability() -> None:
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=2.0, training_samples=200)
    seeds = (3, 5)
    workloads = generate_reliability_workloads(config, seeds)
    strategies = tuple([ScalingReliabilityStrategy.SCALE_THEN_FALLBACK_SHED])
    failure = run_scaling_reliability_benchmark(config, reliability_config=ScalingReliabilityConfig(scale_success_probability=0.0), strategies=strategies, seeds=seeds, workloads=workloads)
    success = run_scaling_reliability_benchmark(config, reliability_config=ScalingReliabilityConfig(scale_success_probability=1.0), strategies=strategies, seeds=seeds, workloads=workloads)
    mixed = mix_scaling_reliability_benchmarks(failure, success, 0.8)
    assert mixed.summaries[0].scale_success_rate == 0.8
    expected_goodput = 0.2 * failure.summaries[0].completion_slo_rate.mean + 0.8 * success.summaries[0].completion_slo_rate.mean
    assert abs(mixed.summaries[0].completion_slo_rate.mean - expected_goodput) < 1e-12
