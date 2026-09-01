from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from statistics import mean

from .scheduler_simulation import MetricEstimate, POLICY_LABELS, SchedulerExperimentConfig, SchedulingPolicy, SimulationResult, _estimate, _percentile, generate_scheduler_workload, run_policy_comparison


OPERATIONAL_POLICIES = tuple(policy for policy in SchedulingPolicy if policy not in (SchedulingPolicy.ORACLE_SJF, SchedulingPolicy.BOUNDED_FAIR_PREDICTED_SJF_AGING))


@dataclass(frozen=True, slots=True)
class SchedulerSLO:
    p95_wait_seconds: float = 120.0
    maximum_wait_seconds: float = 300.0
    fairness_index: float = 0.90
    wait_slo_seconds: float = 120.0
    wait_violation_rate: float = 0.01
    high_priority_wait_seconds: float = 60.0
    high_priority_violation_rate: float = 0.01

    def __post_init__(self) -> None:
        if self.p95_wait_seconds <= 0 or self.maximum_wait_seconds <= 0 or self.wait_slo_seconds <= 0 or self.high_priority_wait_seconds <= 0:
            raise ValueError("wait SLO values must be positive")
        if not 0 < self.fairness_index <= 1:
            raise ValueError("fairness_index must be in the interval (0, 1]")
        if not 0 <= self.wait_violation_rate <= 1 or not 0 <= self.high_priority_violation_rate <= 1:
            raise ValueError("violation rates must be in the interval [0, 1]")


@dataclass(frozen=True, slots=True)
class PolicyEvaluationRow:
    seed: int
    policy: SchedulingPolicy
    mean_completion_seconds: float
    p95_wait_seconds: float
    p99_wait_seconds: float
    maximum_wait_seconds: float
    fairness_index: float
    wait_violation_rate: float
    high_priority_violation_rate: float
    worst_workspace_slowdown: float
    passed_criteria: int
    eligible: bool
    failed_criteria: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PolicyEvaluationSummary:
    policy: SchedulingPolicy
    mean_completion_seconds: MetricEstimate
    p95_wait_seconds: MetricEstimate
    p99_wait_seconds: MetricEstimate
    maximum_wait_seconds: MetricEstimate
    fairness_index: MetricEstimate
    wait_violation_rate: MetricEstimate
    high_priority_violation_rate: MetricEstimate
    worst_workspace_slowdown: MetricEstimate
    passed_criteria: MetricEstimate
    slo_pass_rate: float
    eligible_on_every_seed: bool


@dataclass(frozen=True, slots=True)
class MultiDimensionalEvaluation:
    config: SchedulerExperimentConfig
    slo: SchedulerSLO
    rows: tuple[PolicyEvaluationRow, ...]
    summaries: tuple[PolicyEvaluationSummary, ...]
    prediction_mae_seconds: MetricEstimate
    prediction_rmse_seconds: MetricEstimate
    prediction_r2: MetricEstimate
    offered_load_ratio: MetricEstimate
    selected_policy: SchedulingPolicy | None


def evaluate_policy_result(result: SimulationResult, seed: int, slo: SchedulerSLO) -> PolicyEvaluationRow:
    waits = [task.queue_wait_seconds for task in result.task_results]
    high_priority_waits = [task.queue_wait_seconds for task in result.task_results if task.priority >= 4]
    wait_violation_rate = sum(wait > slo.wait_slo_seconds for wait in waits) / len(waits)
    high_priority_violation_rate = 0.0 if not high_priority_waits else sum(wait > slo.high_priority_wait_seconds for wait in high_priority_waits) / len(high_priority_waits)
    criteria = (("p95_wait", result.metrics.p95_wait_seconds <= slo.p95_wait_seconds), ("maximum_wait", result.metrics.maximum_wait_seconds <= slo.maximum_wait_seconds), ("fairness", result.metrics.fairness_index >= slo.fairness_index), ("wait_violation_rate", wait_violation_rate <= slo.wait_violation_rate), ("high_priority_violation_rate", high_priority_violation_rate <= slo.high_priority_violation_rate))
    failed = tuple(name for name, passed in criteria if not passed)
    return PolicyEvaluationRow(seed=seed, policy=result.policy, mean_completion_seconds=result.metrics.mean_completion_seconds, p95_wait_seconds=result.metrics.p95_wait_seconds, p99_wait_seconds=_percentile(waits, 99), maximum_wait_seconds=result.metrics.maximum_wait_seconds, fairness_index=result.metrics.fairness_index, wait_violation_rate=wait_violation_rate, high_priority_violation_rate=high_priority_violation_rate, worst_workspace_slowdown=max(metric.mean_slowdown for metric in result.workspace_metrics), passed_criteria=len(criteria) - len(failed), eligible=not failed, failed_criteria=failed)


def _summarize_policy(rows: Sequence[PolicyEvaluationRow], policy: SchedulingPolicy) -> PolicyEvaluationSummary:
    selected = [row for row in rows if row.policy is policy]
    return PolicyEvaluationSummary(policy=policy, mean_completion_seconds=_estimate([row.mean_completion_seconds for row in selected]), p95_wait_seconds=_estimate([row.p95_wait_seconds for row in selected]), p99_wait_seconds=_estimate([row.p99_wait_seconds for row in selected]), maximum_wait_seconds=_estimate([row.maximum_wait_seconds for row in selected]), fairness_index=_estimate([row.fairness_index for row in selected]), wait_violation_rate=_estimate([row.wait_violation_rate for row in selected]), high_priority_violation_rate=_estimate([row.high_priority_violation_rate for row in selected]), worst_workspace_slowdown=_estimate([row.worst_workspace_slowdown for row in selected]), passed_criteria=_estimate([float(row.passed_criteria) for row in selected]), slo_pass_rate=mean(float(row.eligible) for row in selected), eligible_on_every_seed=all(row.eligible for row in selected))


def run_multidimensional_evaluation(config: SchedulerExperimentConfig, *, slo: SchedulerSLO | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59)) -> MultiDimensionalEvaluation:
    if not seeds:
        raise ValueError("seeds must not be empty")
    selected_slo = slo or SchedulerSLO()
    rows: list[PolicyEvaluationRow] = []
    prediction_metrics: list[tuple[float, float, float, float]] = []
    for seed in seeds:
        tasks, metrics = generate_scheduler_workload(config, random_seed=seed)
        prediction_metrics.append(metrics)
        comparisons = run_policy_comparison(tasks, worker_count=config.worker_count, max_wait_seconds=config.max_wait_seconds, aging_rate=config.aging_rate, aging_overdue_interval=config.aging_overdue_interval)
        rows.extend(evaluate_policy_result(result, seed, selected_slo) for result in comparisons.values())
    summaries = tuple(_summarize_policy(rows, policy) for policy in SchedulingPolicy)
    eligible = [summary for summary in summaries if summary.policy in OPERATIONAL_POLICIES and summary.eligible_on_every_seed]
    selected_policy = min(eligible, key=lambda summary: summary.mean_completion_seconds.mean).policy if eligible else None
    return MultiDimensionalEvaluation(config=config, slo=selected_slo, rows=tuple(rows), summaries=summaries, prediction_mae_seconds=_estimate([metric[0] for metric in prediction_metrics]), prediction_rmse_seconds=_estimate([metric[1] for metric in prediction_metrics]), prediction_r2=_estimate([metric[2] for metric in prediction_metrics]), offered_load_ratio=_estimate([metric[3] for metric in prediction_metrics]), selected_policy=selected_policy)


def evaluation_rows(evaluation: MultiDimensionalEvaluation) -> list[dict[str, object]]:
    return [{"Policy": POLICY_LABELS[summary.policy], "Mean completion (sec)": round(summary.mean_completion_seconds.mean, 2), "P95 wait (sec)": round(summary.p95_wait_seconds.mean, 2), "P99 wait (sec)": round(summary.p99_wait_seconds.mean, 2), "Maximum wait (sec)": round(summary.maximum_wait_seconds.mean, 2), "Fairness": round(summary.fairness_index.mean, 3), "Wait violations (%)": round(100 * summary.wait_violation_rate.mean, 2), "Priority violations (%)": round(100 * summary.high_priority_violation_rate.mean, 2), "Criteria passed": f"{summary.passed_criteria.mean:.1f}/5", "SLO pass rate (%)": round(100 * summary.slo_pass_rate, 1), "Eligible": summary.eligible_on_every_seed} for summary in evaluation.summaries]
