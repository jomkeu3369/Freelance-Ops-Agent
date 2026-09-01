from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, replace
from statistics import mean

from .hierarchical_scheduler_simulation import HierarchicalConfig, HierarchicalStrategy, simulate_hierarchical_strategy
from .retry_checkpoint_simulation import RetryBudgetScope, RetryExperimentConfig, RetryRun, RetryStrategy, simulate_retry_strategy
from .scheduler_simulation import MetricEstimate, SchedulerTask, _estimate
from .tenant_fairness_simulation import TenantFairnessScenario, generate_tenant_fairness_workload


RETRY_SCOPE_LABELS = {RetryBudgetScope.GLOBAL: "Global budget", RetryBudgetScope.WORKSPACE_TOKEN_BUCKET: "Workspace token bucket", RetryBudgetScope.HIERARCHICAL_TOKEN_BUCKET: "Global + workspace bucket", RetryBudgetScope.HIERARCHICAL_PRIORITY_BORROW: "Hierarchical + priority borrow"}


@dataclass(frozen=True, slots=True)
class WorkspaceRetryBudgetConfig:
    scale_success_probability: float = 0.90
    healthy_failure_probability: float = 0.05
    noisy_failure_probability: float = 0.35
    global_retry_budget_ratio: float = 0.20
    global_bucket_capacity: float = 16.0
    global_refill_tokens_per_second: float = 0.10
    workspace_bucket_capacity: float = 12.0
    workspace_refill_tokens_per_second: float = 0.10
    priority_borrow_limit: float = 2.0
    completion_slo_seconds: float = 300.0
    priority_wait_slo_seconds: float = 60.0
    minimum_submitted_goodput: float = 0.88
    minimum_healthy_goodput: float = 0.95
    minimum_noisy_goodput: float = 0.65
    minimum_priority_goodput: float = 0.95
    minimum_workspace_fairness: float = 0.90
    maximum_demand_amplification: float = 1.25
    maximum_healthy_budget_exhaustion: float = 0.02

    def __post_init__(self) -> None:
        probabilities = (self.scale_success_probability, self.healthy_failure_probability, self.noisy_failure_probability)
        if any(not 0 <= value <= 1 for value in probabilities):
            raise ValueError("probabilities must be within [0, 1]")
        if self.global_retry_budget_ratio < 0 or self.global_bucket_capacity < 1 or self.global_refill_tokens_per_second < 0 or self.workspace_bucket_capacity < 1 or self.workspace_refill_tokens_per_second < 0 or self.priority_borrow_limit < 0:
            raise ValueError("retry budget values are invalid")
        if self.completion_slo_seconds <= 0 or self.priority_wait_slo_seconds <= 0 or self.maximum_demand_amplification < 1:
            raise ValueError("SLO and demand amplification values are invalid")
        rates = (self.minimum_submitted_goodput, self.minimum_healthy_goodput, self.minimum_noisy_goodput, self.minimum_priority_goodput, self.minimum_workspace_fairness, self.maximum_healthy_budget_exhaustion)
        if any(not 0 <= value <= 1 for value in rates):
            raise ValueError("operational gate rates must be within [0, 1]")


@dataclass(frozen=True, slots=True)
class WorkspaceRetryBudgetMetrics:
    submitted_completion_goodput: float
    healthy_workspace_completion_goodput: float
    noisy_workspace_completion_goodput: float
    priority_wait_slo_goodput: float
    workspace_completion_fairness: float
    demand_amplification: float
    retry_budget_exhaustion_rate: float
    healthy_retry_budget_exhaustion_rate: float
    noisy_retry_share: float
    peak_retry_release_count: int
    estimated_worker_cost: float
    passed_gate: bool


@dataclass(frozen=True, slots=True)
class WorkspaceRetryBudgetRun:
    seed: int
    scenario: TenantFairnessScenario
    scope: RetryBudgetScope
    scale_succeeded: bool
    noisy_workspace_id: str
    metrics: WorkspaceRetryBudgetMetrics


@dataclass(frozen=True, slots=True)
class WorkspaceRetryBudgetSummary:
    scope: RetryBudgetScope
    submitted_completion_goodput: MetricEstimate
    healthy_workspace_completion_goodput: MetricEstimate
    noisy_workspace_completion_goodput: MetricEstimate
    priority_wait_slo_goodput: MetricEstimate
    workspace_completion_fairness: MetricEstimate
    demand_amplification: MetricEstimate
    retry_budget_exhaustion_rate: MetricEstimate
    healthy_retry_budget_exhaustion_rate: MetricEstimate
    noisy_retry_share: MetricEstimate
    peak_retry_release_count: MetricEstimate
    estimated_worker_cost: MetricEstimate
    expected_gate_pass_rate: float


@dataclass(frozen=True, slots=True)
class WorkspaceRetryBudgetBenchmark:
    config: WorkspaceRetryBudgetConfig
    hierarchical_config: HierarchicalConfig
    success_rows: tuple[WorkspaceRetryBudgetRun, ...]
    failure_rows: tuple[WorkspaceRetryBudgetRun, ...]
    summaries: tuple[WorkspaceRetryBudgetSummary, ...]
    selected_scope: RetryBudgetScope | None


def _noisy_workspace(scenario: TenantFairnessScenario) -> str:
    if scenario is TenantFairnessScenario.NOISY_NEIGHBOR:
        return "workspace-noisy"
    if scenario is TenantFairnessScenario.SLEEP_WAKE_BURST:
        return "workspace-continuous-a"
    return "workspace-elephant"


def _jain_index(values: Sequence[float]) -> float:
    total = sum(values)
    denominator = len(values) * sum(value * value for value in values)
    return 1.0 if denominator == 0 else total * total / denominator


def _completion_rates(tasks: Sequence[SchedulerTask], completed_at: dict[str, float], completion_slo_seconds: float) -> dict[str, float]:
    grouped: dict[str, list[SchedulerTask]] = defaultdict(list)
    for task in tasks:
        grouped[task.workspace_id].append(task)
    return {workspace_id: sum(task.task_id in completed_at and completed_at[task.task_id] - task.queued_at_seconds <= completion_slo_seconds for task in workspace_tasks) / len(workspace_tasks) for workspace_id, workspace_tasks in grouped.items()}


def _evaluate_run(tasks: Sequence[SchedulerTask], execution: RetryRun, noisy_workspace_id: str, config: WorkspaceRetryBudgetConfig) -> WorkspaceRetryBudgetMetrics:
    completed_at = {result.task_id: float(result.completed_at_seconds) for result in execution.task_results if result.completed_at_seconds is not None}
    started_at = {result.task_id: float(result.first_started_at_seconds) for result in execution.task_results if result.first_started_at_seconds is not None}
    rates = _completion_rates(tasks, completed_at, config.completion_slo_seconds)
    healthy_rates = [rate for workspace_id, rate in rates.items() if workspace_id != noisy_workspace_id]
    priority_tasks = [task for task in tasks if task.priority >= 4]
    priority_goodput = 1.0 if not priority_tasks else sum(task.task_id in started_at and started_at[task.task_id] - task.queued_at_seconds <= config.priority_wait_slo_seconds for task in priority_tasks) / len(priority_tasks)
    healthy_results = [result for result in execution.task_results if result.workspace_id != noisy_workspace_id]
    total_retries = sum(result.retries for result in execution.task_results)
    noisy_retries = sum(result.retries for result in execution.task_results if result.workspace_id == noisy_workspace_id)
    completion_goodput = sum(task.task_id in completed_at and completed_at[task.task_id] - task.queued_at_seconds <= config.completion_slo_seconds for task in tasks) / len(tasks)
    healthy_goodput = mean(healthy_rates)
    noisy_goodput = rates[noisy_workspace_id]
    healthy_exhaustion = sum(result.retry_budget_exhausted for result in healthy_results) / len(healthy_results)
    passed_gate = completion_goodput >= config.minimum_submitted_goodput and healthy_goodput >= config.minimum_healthy_goodput and noisy_goodput >= config.minimum_noisy_goodput and priority_goodput >= config.minimum_priority_goodput and _jain_index(tuple(rates.values())) >= config.minimum_workspace_fairness and execution.metrics.demand_amplification <= config.maximum_demand_amplification and healthy_exhaustion <= config.maximum_healthy_budget_exhaustion
    return WorkspaceRetryBudgetMetrics(submitted_completion_goodput=completion_goodput, healthy_workspace_completion_goodput=healthy_goodput, noisy_workspace_completion_goodput=noisy_goodput, priority_wait_slo_goodput=priority_goodput, workspace_completion_fairness=_jain_index(tuple(rates.values())), demand_amplification=execution.metrics.demand_amplification, retry_budget_exhaustion_rate=execution.metrics.retry_budget_exhaustion_rate, healthy_retry_budget_exhaustion_rate=healthy_exhaustion, noisy_retry_share=0.0 if total_retries == 0 else noisy_retries / total_retries, peak_retry_release_count=execution.metrics.peak_retry_release_count, estimated_worker_cost=execution.metrics.estimated_worker_cost, passed_gate=passed_gate)


def _retry_config(scope: RetryBudgetScope, noisy_workspace_id: str, worker_count: int, config: WorkspaceRetryBudgetConfig) -> RetryExperimentConfig:
    failure_probabilities = tuple([(noisy_workspace_id, config.noisy_failure_probability)])
    return RetryExperimentConfig(worker_count=worker_count, failure_probability=config.healthy_failure_probability, max_attempts=4, checkpoint_interval_seconds=30.0, checkpoint_overhead_seconds=1.0, base_backoff_seconds=15.0, maximum_backoff_seconds=90.0, retry_budget_ratio=config.global_retry_budget_ratio, retry_budget_scope=scope, global_retry_bucket_capacity=config.global_bucket_capacity, global_retry_refill_tokens_per_second=config.global_refill_tokens_per_second, workspace_retry_bucket_capacity=config.workspace_bucket_capacity, workspace_retry_refill_tokens_per_second=config.workspace_refill_tokens_per_second, workspace_priority_borrow_limit=config.priority_borrow_limit, failure_probability_by_workspace=failure_probabilities, completion_slo_seconds=config.completion_slo_seconds, max_wait_seconds=120.0, high_priority_rescue_seconds=30.0)


def _simulate_state(tasks: Sequence[SchedulerTask], scenario: TenantFairnessScenario, scope: RetryBudgetScope, seed: int, scale_succeeded: bool, hierarchical_config: HierarchicalConfig, config: WorkspaceRetryBudgetConfig) -> WorkspaceRetryBudgetRun:
    noisy_workspace_id = _noisy_workspace(scenario)
    plan = simulate_hierarchical_strategy(tasks, HierarchicalStrategy.HIERARCHICAL_SCALE, seed=seed, scenario=scenario, config=hierarchical_config, scale_succeeds=scale_succeeded, failure_fallback=HierarchicalStrategy.WORKSPACE_QUOTA)
    admitted = [outcome for outcome in plan.outcomes if outcome.admitted_at_seconds is not None]
    admitted_tasks = [replace(outcome.task, queued_at_seconds=float(outcome.admitted_at_seconds)) for outcome in admitted]
    execution = simulate_retry_strategy(admitted_tasks, RetryStrategy.CHECKPOINT_BACKOFF_BUDGET, seed=seed, config=_retry_config(scope, noisy_workspace_id, hierarchical_config.worker_count, config), capacity_events=plan.capacity_events)
    metrics = _evaluate_run(tasks, execution, noisy_workspace_id, config)
    return WorkspaceRetryBudgetRun(seed=seed, scenario=scenario, scope=scope, scale_succeeded=scale_succeeded, noisy_workspace_id=noisy_workspace_id, metrics=metrics)


def generate_workspace_retry_budget_rows(*, config: WorkspaceRetryBudgetConfig | None = None, hierarchical_config: HierarchicalConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), scenarios: Sequence[TenantFairnessScenario] = tuple(TenantFairnessScenario), scopes: Sequence[RetryBudgetScope] = tuple(RetryBudgetScope)) -> tuple[tuple[WorkspaceRetryBudgetRun, ...], tuple[WorkspaceRetryBudgetRun, ...]]:
    if not seeds or not scenarios or not scopes:
        raise ValueError("seeds, scenarios and scopes must not be empty")
    selected_config = config or WorkspaceRetryBudgetConfig()
    selected_hierarchical = hierarchical_config or HierarchicalConfig()
    success_rows: list[WorkspaceRetryBudgetRun] = []
    failure_rows: list[WorkspaceRetryBudgetRun] = []
    for scenario in scenarios:
        for seed in seeds:
            tasks = generate_tenant_fairness_workload(scenario, seed=seed)
            for scope in scopes:
                success_rows.append(_simulate_state(tasks, scenario, scope, seed, True, selected_hierarchical, selected_config))
                failure_rows.append(_simulate_state(tasks, scenario, scope, seed, False, selected_hierarchical, selected_config))
    return tuple(success_rows), tuple(failure_rows)


def summarize_workspace_retry_budget(success_rows: Sequence[WorkspaceRetryBudgetRun], failure_rows: Sequence[WorkspaceRetryBudgetRun], scope: RetryBudgetScope, scale_success_probability: float) -> WorkspaceRetryBudgetSummary:
    if not 0 <= scale_success_probability <= 1:
        raise ValueError("scale success probability must be within [0, 1]")
    success = [row for row in success_rows if row.scope is scope]
    failure = [row for row in failure_rows if row.scope is scope]
    if not success or [(row.scenario, row.seed) for row in success] != [(row.scenario, row.seed) for row in failure]:
        raise ValueError("success and failure rows must be non-empty and paired")

    def estimate(name: str) -> MetricEstimate:
        values = [scale_success_probability * float(getattr(success_row.metrics, name)) + (1 - scale_success_probability) * float(getattr(failure_row.metrics, name)) for success_row, failure_row in zip(success, failure, strict=True)]
        return _estimate(values)

    gate_pass = mean(scale_success_probability * float(success_row.metrics.passed_gate) + (1 - scale_success_probability) * float(failure_row.metrics.passed_gate) for success_row, failure_row in zip(success, failure, strict=True))
    return WorkspaceRetryBudgetSummary(scope=scope, submitted_completion_goodput=estimate("submitted_completion_goodput"), healthy_workspace_completion_goodput=estimate("healthy_workspace_completion_goodput"), noisy_workspace_completion_goodput=estimate("noisy_workspace_completion_goodput"), priority_wait_slo_goodput=estimate("priority_wait_slo_goodput"), workspace_completion_fairness=estimate("workspace_completion_fairness"), demand_amplification=estimate("demand_amplification"), retry_budget_exhaustion_rate=estimate("retry_budget_exhaustion_rate"), healthy_retry_budget_exhaustion_rate=estimate("healthy_retry_budget_exhaustion_rate"), noisy_retry_share=estimate("noisy_retry_share"), peak_retry_release_count=estimate("peak_retry_release_count"), estimated_worker_cost=estimate("estimated_worker_cost"), expected_gate_pass_rate=gate_pass)


def build_workspace_retry_budget_benchmark(*, config: WorkspaceRetryBudgetConfig | None = None, hierarchical_config: HierarchicalConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), scenarios: Sequence[TenantFairnessScenario] = tuple(TenantFairnessScenario), scopes: Sequence[RetryBudgetScope] = tuple(RetryBudgetScope)) -> WorkspaceRetryBudgetBenchmark:
    selected_config = config or WorkspaceRetryBudgetConfig()
    selected_hierarchical = hierarchical_config or HierarchicalConfig()
    success_rows, failure_rows = generate_workspace_retry_budget_rows(config=selected_config, hierarchical_config=selected_hierarchical, seeds=seeds, scenarios=scenarios, scopes=scopes)
    summaries = tuple(summarize_workspace_retry_budget(success_rows, failure_rows, scope, selected_config.scale_success_probability) for scope in scopes)
    eligible = [summary for summary in summaries if summary.expected_gate_pass_rate >= 0.90 and summary.submitted_completion_goodput.mean >= selected_config.minimum_submitted_goodput and summary.healthy_workspace_completion_goodput.mean >= selected_config.minimum_healthy_goodput and summary.noisy_workspace_completion_goodput.mean >= selected_config.minimum_noisy_goodput and summary.priority_wait_slo_goodput.mean >= selected_config.minimum_priority_goodput and summary.workspace_completion_fairness.mean >= selected_config.minimum_workspace_fairness and summary.demand_amplification.mean <= selected_config.maximum_demand_amplification and summary.healthy_retry_budget_exhaustion_rate.mean <= selected_config.maximum_healthy_budget_exhaustion]
    selected_scope = min(eligible, key=lambda summary: (summary.estimated_worker_cost.mean, summary.demand_amplification.mean, -summary.submitted_completion_goodput.mean)).scope if eligible else None
    return WorkspaceRetryBudgetBenchmark(config=selected_config, hierarchical_config=selected_hierarchical, success_rows=success_rows, failure_rows=failure_rows, summaries=summaries, selected_scope=selected_scope)
