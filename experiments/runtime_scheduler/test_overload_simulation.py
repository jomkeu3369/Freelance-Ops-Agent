from __future__ import annotations

from .overload_simulation import AdmissionConfig, AdmissionDecision, AdmissionPolicy, AdmissionPolicyEvent, apply_admission_policy, run_admission_benchmark, simulate_admission_policy
from .scheduler_simulation import SchedulerExperimentConfig, SchedulerTask, SchedulingPolicy


def _task(task_id: str, queued_at: float, runtime: float, *, priority: int = 3, workspace_id: str = "workspace") -> SchedulerTask:
    return SchedulerTask(task_id=task_id, workspace_id=workspace_id, queued_at_seconds=queued_at, actual_runtime_seconds=runtime, predicted_runtime_seconds=runtime, priority=priority)


def test_accept_all_never_rejects_or_defers() -> None:
    tasks = [_task(f"task-{index}", 0.0, 10.0) for index in range(5)]
    outcomes = apply_admission_policy(tasks, AdmissionPolicy.ACCEPT_ALL, 1, AdmissionConfig(max_active_drain_seconds=5.0))
    assert all(outcome.decision is AdmissionDecision.ADMIT for outcome in outcomes)


def test_bounded_defer_delays_work_before_rejecting_at_limit() -> None:
    tasks = [_task(f"task-{index}", 0.0, 10.0) for index in range(4)]
    config = AdmissionConfig(max_active_drain_seconds=10.0, max_defer_seconds=15.0, emergency_drain_seconds=30.0)
    outcomes = apply_admission_policy(tasks, AdmissionPolicy.BOUNDED_DEFER, 1, config)
    assert [outcome.decision for outcome in outcomes] == [AdmissionDecision.ADMIT, AdmissionDecision.DEFER, AdmissionDecision.REJECT, AdmissionDecision.REJECT]
    assert outcomes[1].admission_delay_seconds == 10.0


def test_priority_shed_preserves_high_priority_within_emergency_capacity() -> None:
    tasks = [_task("base", 0.0, 10.0), _task("low", 0.0, 10.0, priority=1), _task("high", 0.0, 10.0, priority=5)]
    config = AdmissionConfig(max_active_drain_seconds=10.0, emergency_drain_seconds=30.0)
    outcomes = apply_admission_policy(tasks, AdmissionPolicy.PRIORITY_SHED, 1, config)
    by_id = {outcome.task.task_id: outcome.decision for outcome in outcomes}
    assert by_id["low"] is AdmissionDecision.REJECT
    assert by_id["high"] is AdmissionDecision.ADMIT


def test_hybrid_guard_rejects_low_priority_and_defers_normal_priority() -> None:
    tasks = [_task("base", 0.0, 10.0), _task("low", 0.0, 5.0, priority=1), _task("normal", 0.0, 5.0, priority=3)]
    config = AdmissionConfig(max_active_drain_seconds=10.0, max_defer_seconds=30.0, emergency_drain_seconds=30.0)
    outcomes = apply_admission_policy(tasks, AdmissionPolicy.HYBRID_GUARD, 1, config)
    by_id = {outcome.task.task_id: outcome.decision for outcome in outcomes}
    assert by_id["low"] is AdmissionDecision.REJECT
    assert by_id["normal"] is AdmissionDecision.DEFER


def test_admission_policy_event_switches_future_arrivals_to_priority_shed() -> None:
    tasks = [_task("before", 0.0, 20.0, priority=1), _task("after", 10.0, 20.0, priority=1)]
    config = AdmissionConfig(max_active_drain_seconds=5.0, emergency_drain_seconds=40.0)
    outcomes = apply_admission_policy(tasks, AdmissionPolicy.ACCEPT_ALL, 1, config, policy_events=tuple([AdmissionPolicyEvent(at_seconds=5.0, policy=AdmissionPolicy.PRIORITY_SHED)]))
    assert outcomes[0].decision is AdmissionDecision.ADMIT
    assert outcomes[1].decision is AdmissionDecision.REJECT


def test_admission_simulation_counts_rejections_against_completion_slo() -> None:
    tasks = [_task(f"task-{index}", 0.0, 10.0, priority=1) for index in range(5)]
    config = AdmissionConfig(max_active_drain_seconds=10.0, emergency_drain_seconds=20.0, completion_slo_seconds=100.0)
    result = simulate_admission_policy(tasks, AdmissionPolicy.PRIORITY_SHED, worker_count=1, scheduler_policy=SchedulingPolicy.FIFO, admission_config=config)
    assert result.metrics.rejected_rate == 0.8
    assert result.metrics.completion_slo_rate == 0.2
    assert len(result.scheduler_result.task_results) == 1


def test_admission_benchmark_returns_every_policy_for_every_seed() -> None:
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=3.0, training_samples=200)
    benchmark = run_admission_benchmark(config, seeds=(3, 5))
    assert len(benchmark.rows) == len(AdmissionPolicy) * 2
    assert {summary.policy for summary in benchmark.summaries} == set(AdmissionPolicy)
    assert benchmark.offered_load_ratio.mean > 0
    assert all(0 <= summary.rejected_rate.mean <= 1 for summary in benchmark.summaries)
