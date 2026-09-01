from __future__ import annotations

import pytest

from .hierarchical_scheduler_simulation import HierarchicalConfig, HierarchicalStrategy, apply_hierarchical_admission, run_hierarchical_benchmark, simulate_hierarchical_strategy
from .overload_simulation import AdmissionDecision
from .scheduler_simulation import SchedulerTask
from .tenant_fairness_simulation import TenantFairnessScenario, generate_tenant_fairness_workload


def _task(task_id: str, workspace_id: str, runtime: float, *, queued_at: float = 0.0, priority: int = 3) -> SchedulerTask:
    return SchedulerTask(task_id=task_id, workspace_id=workspace_id, queued_at_seconds=queued_at, actual_runtime_seconds=runtime, predicted_runtime_seconds=runtime, priority=priority)


def test_hierarchical_config_rejects_invalid_capacity_values() -> None:
    with pytest.raises(ValueError, match="worker"):
        HierarchicalConfig(worker_count=0)
    with pytest.raises(ValueError, match="priority thresholds"):
        HierarchicalConfig(low_priority_threshold=4, high_priority_threshold=4)
    with pytest.raises(ValueError, match="scale factor"):
        HierarchicalConfig(scale_factor=1.0)
    with pytest.raises(ValueError, match="hard deadline"):
        HierarchicalConfig(scale_delay_seconds=60.0, scale_hard_deadline_seconds=30.0)


def test_workspace_quota_isolates_bursting_workspace() -> None:
    tasks = [_task(f"noisy-{index}", "workspace-noisy", 30.0, priority=2) for index in range(10)]
    tasks.append(_task("quiet", "workspace-quiet", 30.0, priority=3))
    config = HierarchicalConfig(worker_count=2, workspace_burst_work_seconds=60.0, maximum_defer_seconds=30.0)
    outcomes, _ = apply_hierarchical_admission(tasks, HierarchicalStrategy.WORKSPACE_QUOTA, config)
    noisy_rejections = sum(outcome.decision is AdmissionDecision.REJECT for outcome in outcomes if outcome.task.workspace_id == "workspace-noisy")
    quiet = next(outcome for outcome in outcomes if outcome.task.task_id == "quiet")
    assert noisy_rejections > 0
    assert quiet.decision is AdmissionDecision.ADMIT


def test_hierarchical_scale_emits_one_capacity_event_on_infeasible_burst() -> None:
    tasks = [_task(f"burst-{index}", "workspace", 60.0, priority=5) for index in range(12)]
    config = HierarchicalConfig(worker_count=2, scale_factor=2.0, scale_delay_seconds=10.0)
    outcomes, events = apply_hierarchical_admission(tasks, HierarchicalStrategy.HIERARCHICAL_SCALE, config)
    assert len(events) == 1
    assert events[0].worker_count == 4
    assert any(outcome.priority_infeasible for outcome in outcomes)


def test_rejections_count_against_hierarchical_goodput() -> None:
    tasks = tuple(_task(f"task-{index}", "workspace", 30.0, priority=2) for index in range(20))
    config = HierarchicalConfig(worker_count=2, workspace_burst_work_seconds=60.0, maximum_defer_seconds=10.0)
    result = simulate_hierarchical_strategy(tasks, HierarchicalStrategy.WORKSPACE_QUOTA, seed=1, scenario=TenantFairnessScenario.NOISY_NEIGHBOR, config=config)
    assert result.metrics.rejected_rate > 0
    assert result.metrics.completion_slo_goodput <= result.metrics.admitted_rate


def test_hierarchical_benchmark_covers_every_strategy_and_scenario() -> None:
    benchmark = run_hierarchical_benchmark(seeds=(3, 5))
    assert len(benchmark.rows) == len(HierarchicalStrategy) * len(TenantFairnessScenario) * 2
    assert len(benchmark.summaries) == len(HierarchicalStrategy)
    assert all(0 <= summary.hard_gate_pass_rate <= 1 for summary in benchmark.summaries)
    assert all(0 <= summary.completion_slo_goodput.mean <= 1 for summary in benchmark.summaries)
    assert benchmark.selected_strategy is HierarchicalStrategy.HIERARCHICAL_SCALE


def test_hierarchical_scale_improves_elephant_burst_goodput() -> None:
    tasks = generate_tenant_fairness_workload(TenantFairnessScenario.ELEPHANT_AND_MICE, seed=11)
    static = simulate_hierarchical_strategy(tasks, HierarchicalStrategy.HIERARCHICAL_STATIC, seed=11, scenario=TenantFairnessScenario.ELEPHANT_AND_MICE)
    scaled = simulate_hierarchical_strategy(tasks, HierarchicalStrategy.HIERARCHICAL_SCALE, seed=11, scenario=TenantFairnessScenario.ELEPHANT_AND_MICE)
    assert scaled.metrics.completion_slo_goodput > static.metrics.completion_slo_goodput
    assert scaled.metrics.high_priority_wait_slo_goodput >= static.metrics.high_priority_wait_slo_goodput


def test_failed_scale_activates_configured_fallback_after_deadline() -> None:
    tasks = generate_tenant_fairness_workload(TenantFairnessScenario.ELEPHANT_AND_MICE, seed=11)
    scale_only = simulate_hierarchical_strategy(tasks, HierarchicalStrategy.HIERARCHICAL_SCALE, seed=11, scenario=TenantFairnessScenario.ELEPHANT_AND_MICE, scale_succeeds=False)
    fallback = simulate_hierarchical_strategy(tasks, HierarchicalStrategy.HIERARCHICAL_SCALE, seed=11, scenario=TenantFairnessScenario.ELEPHANT_AND_MICE, scale_succeeds=False, failure_fallback=HierarchicalStrategy.HIERARCHICAL_STATIC)
    assert not scale_only.capacity_events
    assert not fallback.capacity_events
    assert fallback.metrics.rejected_rate > scale_only.metrics.rejected_rate
    assert fallback.metrics.maximum_wait_seconds < scale_only.metrics.maximum_wait_seconds
