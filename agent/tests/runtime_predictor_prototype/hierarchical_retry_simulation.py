from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from statistics import mean

from .hierarchical_scheduler_simulation import HierarchicalConfig, HierarchicalStrategy, simulate_hierarchical_strategy
from .retry_checkpoint_simulation import RetryExperimentConfig, RetryStrategy, simulate_retry_strategy
from .scheduler_simulation import MetricEstimate, SchedulerTask, WorkerCapacityEvent, _estimate, _percentile
from .tenant_fairness_simulation import TenantFairnessScenario, generate_tenant_fairness_workload


class FailureMode(StrEnum):
    INDEPENDENT = "independent"
    PROVIDER_OUTAGE = "provider_outage"


class RecoveryPolicy(StrEnum):
    RESTART_BACKOFF_BUDGET = "restart_backoff_budget"
    CHECKPOINT_IMMEDIATE = "checkpoint_immediate"
    CHECKPOINT_BACKOFF = "checkpoint_backoff"
    CHECKPOINT_BACKOFF_BUDGET = "checkpoint_backoff_budget"
    FAILURE_AWARE = "failure_aware"


RECOVERY_LABELS = {RecoveryPolicy.RESTART_BACKOFF_BUDGET: "Restart + backoff + budget", RecoveryPolicy.CHECKPOINT_IMMEDIATE: "Checkpoint immediate", RecoveryPolicy.CHECKPOINT_BACKOFF: "Checkpoint + backoff", RecoveryPolicy.CHECKPOINT_BACKOFF_BUDGET: "Checkpoint + backoff + budget", RecoveryPolicy.FAILURE_AWARE: "Failure-aware checkpoint + failover"}
FAILURE_MODE_LABELS = {FailureMode.INDEPENDENT: "Independent transient", FailureMode.PROVIDER_OUTAGE: "Correlated provider outage"}


@dataclass(frozen=True, slots=True)
class HierarchicalRetryConfig:
    scale_success_probability: float = 0.90
    independent_failure_probability: float = 0.20
    outage_background_failure_probability: float = 0.05
    outage_at_seconds: float = 60.0
    outage_duration_seconds: float = 60.0
    provider_failover_seconds: float = 20.0
    secondary_provider_latency_multiplier: float = 1.15
    secondary_provider_cost_multiplier: float = 1.25
    secondary_provider_quality_failure_rate: float = 0.02
    max_attempts: int = 4
    checkpoint_interval_seconds: float = 30.0
    checkpoint_overhead_seconds: float = 1.0
    base_backoff_seconds: float = 30.0
    maximum_backoff_seconds: float = 180.0
    retry_budget_ratio: float = 0.20
    high_priority_rescue_seconds: float = 30.0
    high_priority_reserved_workers: int = 0
    minimum_scale_billing_seconds: float = 600.0
    worker_hour_cost: float = 0.12

    def __post_init__(self) -> None:
        probabilities = (self.scale_success_probability, self.independent_failure_probability, self.outage_background_failure_probability, self.secondary_provider_quality_failure_rate)
        if any(not 0 <= value <= 1 for value in probabilities):
            raise ValueError("probabilities must be within [0, 1]")
        if self.max_attempts < 1 or self.checkpoint_interval_seconds <= 0 or self.checkpoint_overhead_seconds < 0:
            raise ValueError("attempt and checkpoint values are invalid")
        if self.outage_at_seconds < 0 or self.outage_duration_seconds < 0 or self.provider_failover_seconds < 0 or self.base_backoff_seconds < 0 or self.maximum_backoff_seconds < self.base_backoff_seconds:
            raise ValueError("outage and backoff values are invalid")
        if self.retry_budget_ratio < 0 or self.high_priority_rescue_seconds < 0 or self.high_priority_reserved_workers < 0 or self.minimum_scale_billing_seconds < 0 or self.worker_hour_cost <= 0:
            raise ValueError("budget, billing and cost values are invalid")
        if self.secondary_provider_latency_multiplier < 1 or self.secondary_provider_cost_multiplier <= 0:
            raise ValueError("secondary provider multipliers are invalid")


@dataclass(frozen=True, slots=True)
class HierarchicalRetryMetrics:
    admitted_rate: float
    completion_slo_goodput: float
    quality_adjusted_completion_goodput: float
    high_priority_wait_slo_goodput: float
    worst_workspace_completion_goodput: float
    workspace_acceptance_fairness: float
    p95_end_to_end_seconds: float
    maximum_wait_seconds: float
    demand_amplification: float
    secondary_provider_service_share: float
    provider_cost_index: float
    wasted_useful_seconds: float
    checkpoint_saved_work_seconds: float
    retry_count: int
    retry_budget_exhaustion_rate: float
    peak_retry_release_count: int
    recovery_after_disturbance_seconds: float
    estimated_worker_cost: float
    slo_tasks_per_worker_dollar: float


@dataclass(frozen=True, slots=True)
class HierarchicalRetryStateRun:
    seed: int
    scenario: TenantFairnessScenario
    failure_mode: FailureMode
    policy: RecoveryPolicy
    scale_succeeded: bool
    metrics: HierarchicalRetryMetrics


@dataclass(frozen=True, slots=True)
class HierarchicalRetrySummary:
    policy: RecoveryPolicy
    admitted_rate: MetricEstimate
    completion_slo_goodput: MetricEstimate
    quality_adjusted_completion_goodput: MetricEstimate
    high_priority_wait_slo_goodput: MetricEstimate
    worst_workspace_completion_goodput: MetricEstimate
    workspace_acceptance_fairness: MetricEstimate
    p95_end_to_end_seconds: MetricEstimate
    maximum_wait_seconds: MetricEstimate
    demand_amplification: MetricEstimate
    secondary_provider_service_share: MetricEstimate
    provider_cost_index: MetricEstimate
    wasted_useful_seconds: MetricEstimate
    checkpoint_saved_work_seconds: MetricEstimate
    retry_count: MetricEstimate
    retry_budget_exhaustion_rate: MetricEstimate
    peak_retry_release_count: MetricEstimate
    recovery_after_disturbance_seconds: MetricEstimate
    estimated_worker_cost: MetricEstimate
    slo_tasks_per_worker_dollar: MetricEstimate
    expected_hard_gate_pass_rate: float
    hard_gate_pass_by_mode: tuple[tuple[FailureMode, float], ...]


@dataclass(frozen=True, slots=True)
class HierarchicalRetryBenchmark:
    hierarchical_config: HierarchicalConfig
    retry_config: HierarchicalRetryConfig
    success_rows: tuple[HierarchicalRetryStateRun, ...]
    failure_rows: tuple[HierarchicalRetryStateRun, ...]
    summaries: tuple[HierarchicalRetrySummary, ...]
    selected_policy: RecoveryPolicy | None


def _retry_strategy(policy: RecoveryPolicy, failure_mode: FailureMode) -> RetryStrategy:
    if policy is RecoveryPolicy.RESTART_BACKOFF_BUDGET:
        return RetryStrategy.RESTART_BACKOFF_BUDGET
    if policy is RecoveryPolicy.CHECKPOINT_IMMEDIATE:
        return RetryStrategy.CHECKPOINT_IMMEDIATE
    if policy is RecoveryPolicy.CHECKPOINT_BACKOFF:
        return RetryStrategy.CHECKPOINT_BACKOFF
    if policy is RecoveryPolicy.CHECKPOINT_BACKOFF_BUDGET:
        return RetryStrategy.CHECKPOINT_BACKOFF_BUDGET
    return RetryStrategy.CHECKPOINT_IMMEDIATE if failure_mode is FailureMode.INDEPENDENT else RetryStrategy.CHECKPOINT_BACKOFF_BUDGET


def _retry_config(config: HierarchicalRetryConfig, hierarchical_config: HierarchicalConfig, failure_mode: FailureMode, policy: RecoveryPolicy) -> RetryExperimentConfig:
    outage_at = None if failure_mode is FailureMode.INDEPENDENT else config.outage_at_seconds
    outage_duration = 0.0 if failure_mode is FailureMode.INDEPENDENT else min(config.outage_duration_seconds, config.provider_failover_seconds) if policy is RecoveryPolicy.FAILURE_AWARE else config.outage_duration_seconds
    failure_probability = config.independent_failure_probability if failure_mode is FailureMode.INDEPENDENT else config.outage_background_failure_probability
    reserved_workers = min(config.high_priority_reserved_workers, hierarchical_config.worker_count - 1)
    secondary_after = config.outage_at_seconds + config.provider_failover_seconds if failure_mode is FailureMode.PROVIDER_OUTAGE and policy is RecoveryPolicy.FAILURE_AWARE else None
    secondary_until = config.outage_at_seconds + config.outage_duration_seconds if secondary_after is not None else None
    return RetryExperimentConfig(worker_count=hierarchical_config.worker_count, failure_probability=failure_probability, max_attempts=config.max_attempts, checkpoint_interval_seconds=config.checkpoint_interval_seconds, checkpoint_overhead_seconds=config.checkpoint_overhead_seconds, base_backoff_seconds=config.base_backoff_seconds, maximum_backoff_seconds=config.maximum_backoff_seconds, retry_budget_ratio=config.retry_budget_ratio, completion_slo_seconds=hierarchical_config.completion_slo_seconds, max_wait_seconds=hierarchical_config.global_drain_limit_seconds, high_priority_rescue_seconds=config.high_priority_rescue_seconds, high_priority_reserved_workers=reserved_workers, outage_at_seconds=outage_at, outage_duration_seconds=outage_duration, worker_hour_cost=config.worker_hour_cost, secondary_provider_after_seconds=secondary_after, secondary_provider_until_seconds=secondary_until, secondary_provider_latency_multiplier=config.secondary_provider_latency_multiplier, secondary_provider_cost_multiplier=config.secondary_provider_cost_multiplier)


def _workspace_goodput(tasks: Sequence[SchedulerTask], completed_at: dict[str, float], completion_slo_seconds: float) -> float:
    grouped: dict[str, list[SchedulerTask]] = defaultdict(list)
    for task in tasks:
        grouped[task.workspace_id].append(task)
    rates = [sum(task.task_id in completed_at and completed_at[task.task_id] - task.queued_at_seconds <= completion_slo_seconds for task in workspace_tasks) / len(workspace_tasks) for workspace_tasks in grouped.values()]
    return min(rates)


def _scaled_cost(first_arrival: float, last_terminal: float, capacity_events: Sequence[WorkerCapacityEvent], hierarchical_config: HierarchicalConfig, retry_config: HierarchicalRetryConfig) -> float:
    base_seconds = hierarchical_config.worker_count * (last_terminal - first_arrival)
    if not capacity_events:
        return base_seconds * retry_config.worker_hour_cost / 3_600
    event = capacity_events[0]
    extra_workers = event.worker_count - hierarchical_config.worker_count
    extra_duration = max(retry_config.minimum_scale_billing_seconds, last_terminal - event.at_seconds)
    billed_seconds = base_seconds + extra_workers * max(0.0, extra_duration)
    return billed_seconds * retry_config.worker_hour_cost / 3_600


def _simulate_state(tasks: Sequence[SchedulerTask], policy: RecoveryPolicy, failure_mode: FailureMode, *, seed: int, scenario: TenantFairnessScenario, scale_succeeded: bool, hierarchical_config: HierarchicalConfig, retry_config: HierarchicalRetryConfig) -> HierarchicalRetryStateRun:
    plan = simulate_hierarchical_strategy(tasks, HierarchicalStrategy.HIERARCHICAL_SCALE, seed=seed, scenario=scenario, config=hierarchical_config, scale_succeeds=scale_succeeded, failure_fallback=HierarchicalStrategy.WORKSPACE_QUOTA)
    admitted = [outcome for outcome in plan.outcomes if outcome.admitted_at_seconds is not None]
    admitted_tasks = [replace(outcome.task, queued_at_seconds=float(outcome.admitted_at_seconds)) for outcome in admitted]
    retry_strategy = _retry_strategy(policy, failure_mode)
    execution = simulate_retry_strategy(admitted_tasks, retry_strategy, seed=seed, config=_retry_config(retry_config, hierarchical_config, failure_mode, policy), capacity_events=plan.capacity_events)
    original_by_id = {task.task_id: task for task in tasks}
    completed_at = {result.task_id: float(result.completed_at_seconds) for result in execution.task_results if result.completed_at_seconds is not None}
    started_at = {result.task_id: float(result.first_started_at_seconds) for result in execution.task_results if result.first_started_at_seconds is not None}
    terminal_at = [result.terminal_at_seconds for result in execution.task_results]
    completion_slo_count = sum(task.task_id in completed_at and completed_at[task.task_id] - task.queued_at_seconds <= hierarchical_config.completion_slo_seconds for task in tasks)
    priority_tasks = [task for task in tasks if task.priority >= hierarchical_config.high_priority_threshold]
    priority_slo_count = sum(task.task_id in started_at and started_at[task.task_id] - task.queued_at_seconds <= hierarchical_config.priority_wait_slo_seconds for task in priority_tasks)
    completion_times = [completed_at[task_id] - original_by_id[task_id].queued_at_seconds for task_id in completed_at]
    wait_times = [started_at[task_id] - original_by_id[task_id].queued_at_seconds for task_id in started_at]
    first_arrival = min(task.queued_at_seconds for task in tasks)
    last_terminal = max(terminal_at)
    cost = _scaled_cost(first_arrival, last_terminal, plan.capacity_events, hierarchical_config, retry_config)
    completion_goodput = completion_slo_count / len(tasks)
    quality_adjusted_goodput = completion_goodput * (1 - execution.metrics.secondary_provider_service_share * retry_config.secondary_provider_quality_failure_rate)
    metrics = HierarchicalRetryMetrics(admitted_rate=len(admitted) / len(tasks), completion_slo_goodput=completion_goodput, quality_adjusted_completion_goodput=quality_adjusted_goodput, high_priority_wait_slo_goodput=1.0 if not priority_tasks else priority_slo_count / len(priority_tasks), worst_workspace_completion_goodput=_workspace_goodput(tasks, completed_at, hierarchical_config.completion_slo_seconds), workspace_acceptance_fairness=plan.metrics.workspace_acceptance_fairness, p95_end_to_end_seconds=_percentile(completion_times, 95), maximum_wait_seconds=max(wait_times), demand_amplification=execution.metrics.demand_amplification, secondary_provider_service_share=execution.metrics.secondary_provider_service_share, provider_cost_index=execution.metrics.provider_cost_index, wasted_useful_seconds=execution.metrics.wasted_useful_seconds, checkpoint_saved_work_seconds=execution.metrics.checkpoint_saved_work_seconds, retry_count=execution.metrics.retry_count, retry_budget_exhaustion_rate=execution.metrics.retry_budget_exhaustion_rate, peak_retry_release_count=execution.metrics.peak_retry_release_count, recovery_after_disturbance_seconds=execution.metrics.recovery_after_disturbance_seconds, estimated_worker_cost=cost, slo_tasks_per_worker_dollar=0.0 if cost == 0 else completion_slo_count / cost)
    return HierarchicalRetryStateRun(seed=seed, scenario=scenario, failure_mode=failure_mode, policy=policy, scale_succeeded=scale_succeeded, metrics=metrics)


def generate_hierarchical_retry_rows(*, hierarchical_config: HierarchicalConfig | None = None, retry_config: HierarchicalRetryConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), scenarios: Sequence[TenantFairnessScenario] = tuple(TenantFairnessScenario), failure_modes: Sequence[FailureMode] = tuple(FailureMode), policies: Sequence[RecoveryPolicy] = tuple(RecoveryPolicy)) -> tuple[tuple[HierarchicalRetryStateRun, ...], tuple[HierarchicalRetryStateRun, ...]]:
    if not seeds or not scenarios or not failure_modes or not policies:
        raise ValueError("seeds, scenarios, failure modes and policies must not be empty")
    selected_hierarchical = hierarchical_config or HierarchicalConfig()
    selected_retry = retry_config or HierarchicalRetryConfig()
    success_rows: list[HierarchicalRetryStateRun] = []
    failure_rows: list[HierarchicalRetryStateRun] = []
    for scenario in scenarios:
        for seed in seeds:
            tasks = generate_tenant_fairness_workload(scenario, seed=seed)
            for failure_mode in failure_modes:
                for policy in policies:
                    success_rows.append(_simulate_state(tasks, policy, failure_mode, seed=seed, scenario=scenario, scale_succeeded=True, hierarchical_config=selected_hierarchical, retry_config=selected_retry))
                    failure_rows.append(_simulate_state(tasks, policy, failure_mode, seed=seed, scenario=scenario, scale_succeeded=False, hierarchical_config=selected_hierarchical, retry_config=selected_retry))
    return tuple(success_rows), tuple(failure_rows)


def _hard_gate(metrics: HierarchicalRetryMetrics) -> bool:
    return metrics.completion_slo_goodput >= 0.95 and metrics.quality_adjusted_completion_goodput >= 0.95 and metrics.high_priority_wait_slo_goodput >= 0.95 and metrics.worst_workspace_completion_goodput >= 0.90 and metrics.workspace_acceptance_fairness >= 0.90 and metrics.maximum_wait_seconds <= 300.0 and metrics.retry_budget_exhaustion_rate <= 0.05


def _paired(success_rows: Sequence[HierarchicalRetryStateRun], failure_rows: Sequence[HierarchicalRetryStateRun], policy: RecoveryPolicy) -> tuple[list[HierarchicalRetryStateRun], list[HierarchicalRetryStateRun]]:
    success = [row for row in success_rows if row.policy is policy]
    failure = [row for row in failure_rows if row.policy is policy]
    success_keys = [(row.scenario, row.seed, row.failure_mode) for row in success]
    failure_keys = [(row.scenario, row.seed, row.failure_mode) for row in failure]
    if not success or success_keys != failure_keys:
        raise ValueError("success and failure rows must be non-empty and paired")
    return success, failure


def summarize_hierarchical_retry(success_rows: Sequence[HierarchicalRetryStateRun], failure_rows: Sequence[HierarchicalRetryStateRun], policy: RecoveryPolicy, scale_success_probability: float) -> HierarchicalRetrySummary:
    if not 0 <= scale_success_probability <= 1:
        raise ValueError("scale success probability must be within [0, 1]")
    success, failure = _paired(success_rows, failure_rows, policy)

    def estimate(name: str) -> MetricEstimate:
        values = [scale_success_probability * float(getattr(success_row.metrics, name)) + (1 - scale_success_probability) * float(getattr(failure_row.metrics, name)) for success_row, failure_row in zip(success, failure, strict=True)]
        return _estimate(values)

    hard_gate_pass = mean(scale_success_probability * float(_hard_gate(success_row.metrics)) + (1 - scale_success_probability) * float(_hard_gate(failure_row.metrics)) for success_row, failure_row in zip(success, failure, strict=True))
    gate_by_mode: list[tuple[FailureMode, float]] = []
    for failure_mode in FailureMode:
        selected_pairs = [(success_row, failure_row) for success_row, failure_row in zip(success, failure, strict=True) if success_row.failure_mode is failure_mode]
        if selected_pairs:
            mode_rate = mean(scale_success_probability * float(_hard_gate(success_row.metrics)) + (1 - scale_success_probability) * float(_hard_gate(failure_row.metrics)) for success_row, failure_row in selected_pairs)
            gate_by_mode.append((failure_mode, mode_rate))
    return HierarchicalRetrySummary(policy=policy, admitted_rate=estimate("admitted_rate"), completion_slo_goodput=estimate("completion_slo_goodput"), quality_adjusted_completion_goodput=estimate("quality_adjusted_completion_goodput"), high_priority_wait_slo_goodput=estimate("high_priority_wait_slo_goodput"), worst_workspace_completion_goodput=estimate("worst_workspace_completion_goodput"), workspace_acceptance_fairness=estimate("workspace_acceptance_fairness"), p95_end_to_end_seconds=estimate("p95_end_to_end_seconds"), maximum_wait_seconds=estimate("maximum_wait_seconds"), demand_amplification=estimate("demand_amplification"), secondary_provider_service_share=estimate("secondary_provider_service_share"), provider_cost_index=estimate("provider_cost_index"), wasted_useful_seconds=estimate("wasted_useful_seconds"), checkpoint_saved_work_seconds=estimate("checkpoint_saved_work_seconds"), retry_count=estimate("retry_count"), retry_budget_exhaustion_rate=estimate("retry_budget_exhaustion_rate"), peak_retry_release_count=estimate("peak_retry_release_count"), recovery_after_disturbance_seconds=estimate("recovery_after_disturbance_seconds"), estimated_worker_cost=estimate("estimated_worker_cost"), slo_tasks_per_worker_dollar=estimate("slo_tasks_per_worker_dollar"), expected_hard_gate_pass_rate=hard_gate_pass, hard_gate_pass_by_mode=tuple(gate_by_mode))


def build_hierarchical_retry_benchmark(*, hierarchical_config: HierarchicalConfig | None = None, retry_config: HierarchicalRetryConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), scenarios: Sequence[TenantFairnessScenario] = tuple(TenantFairnessScenario), failure_modes: Sequence[FailureMode] = tuple(FailureMode), policies: Sequence[RecoveryPolicy] = tuple(RecoveryPolicy), state_rows: tuple[Sequence[HierarchicalRetryStateRun], Sequence[HierarchicalRetryStateRun]] | None = None) -> HierarchicalRetryBenchmark:
    selected_hierarchical = hierarchical_config or HierarchicalConfig()
    selected_retry = retry_config or HierarchicalRetryConfig()
    success_rows, failure_rows = state_rows or generate_hierarchical_retry_rows(hierarchical_config=selected_hierarchical, retry_config=selected_retry, seeds=seeds, scenarios=scenarios, failure_modes=failure_modes, policies=policies)
    summaries = tuple(summarize_hierarchical_retry(success_rows, failure_rows, policy, selected_retry.scale_success_probability) for policy in policies)
    eligible = [summary for summary in summaries if summary.completion_slo_goodput.mean >= 0.95 and summary.quality_adjusted_completion_goodput.mean >= 0.95 and summary.high_priority_wait_slo_goodput.mean >= 0.95 and summary.worst_workspace_completion_goodput.mean >= 0.90 and summary.workspace_acceptance_fairness.mean >= 0.90 and summary.retry_budget_exhaustion_rate.mean <= 0.05 and summary.expected_hard_gate_pass_rate >= 0.90 and all(rate >= 0.90 for _, rate in summary.hard_gate_pass_by_mode)]
    selected_policy = max(eligible, key=lambda summary: summary.slo_tasks_per_worker_dollar.mean).policy if eligible else None
    return HierarchicalRetryBenchmark(hierarchical_config=selected_hierarchical, retry_config=selected_retry, success_rows=tuple(success_rows), failure_rows=tuple(failure_rows), summaries=summaries, selected_policy=selected_policy)
