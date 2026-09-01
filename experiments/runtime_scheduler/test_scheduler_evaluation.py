from __future__ import annotations

from .scheduler_evaluation import OPERATIONAL_POLICIES, SchedulerSLO, evaluate_policy_result, run_multidimensional_evaluation
from .scheduler_simulation import SchedulerExperimentConfig, SchedulerTask, SchedulingPolicy, simulate_scheduler


def _task(task_id: str, runtime: float, *, queued_at: float = 0.0, priority: int = 3) -> SchedulerTask:
    return SchedulerTask(task_id=task_id, workspace_id="workspace", queued_at_seconds=queued_at, actual_runtime_seconds=runtime, predicted_runtime_seconds=runtime, priority=priority)


def test_policy_evaluation_rejects_tail_and_priority_slo_violations() -> None:
    tasks = [_task("long", 20.0), _task("priority", 1.0, priority=5), _task("normal", 1.0)]
    result = simulate_scheduler(tasks, SchedulingPolicy.FIFO, worker_count=1, max_wait_seconds=10.0)
    slo = SchedulerSLO(p95_wait_seconds=5.0, maximum_wait_seconds=15.0, wait_slo_seconds=5.0, wait_violation_rate=0.0, high_priority_wait_seconds=5.0, high_priority_violation_rate=0.0)
    evaluation = evaluate_policy_result(result, 7, slo)
    assert not evaluation.eligible
    assert "maximum_wait" in evaluation.failed_criteria
    assert "high_priority_violation_rate" in evaluation.failed_criteria


def test_multidimensional_evaluation_keeps_rejected_candidate_out_of_operational_selection() -> None:
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, training_samples=200)
    evaluation = run_multidimensional_evaluation(config, seeds=(3, 5))
    assert len(OPERATIONAL_POLICIES) == 7
    assert len(evaluation.summaries) == 9
    assert len(evaluation.rows) == 18
    assert SchedulingPolicy.BOUNDED_FAIR_PREDICTED_SJF_AGING not in OPERATIONAL_POLICIES
    assert all(0 <= summary.slo_pass_rate <= 1 for summary in evaluation.summaries)
    assert all(0 <= summary.passed_criteria.mean <= 5 for summary in evaluation.summaries)
