from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

from .hierarchical_retry_simulation import FailureMode, HierarchicalRetryConfig, HierarchicalRetryMetrics, HierarchicalRetryStateRun, RecoveryPolicy, _hard_gate, generate_hierarchical_retry_rows
from .hierarchical_scheduler_simulation import HierarchicalConfig
from .scheduler_simulation import MetricEstimate, _estimate
from .tenant_fairness_simulation import TenantFairnessScenario


@dataclass(frozen=True, slots=True)
class FailureClassifierConfig:
    false_positive_rate: float = 0.05
    false_negative_rate: float = 0.10

    def __post_init__(self) -> None:
        if not 0 <= self.false_positive_rate <= 1 or not 0 <= self.false_negative_rate <= 1:
            raise ValueError("classifier error rates must be within [0, 1]")


@dataclass(frozen=True, slots=True)
class FailureClassifierSummary:
    classifier_config: FailureClassifierConfig
    completion_slo_goodput: MetricEstimate
    quality_adjusted_completion_goodput: MetricEstimate
    high_priority_wait_slo_goodput: MetricEstimate
    worst_workspace_completion_goodput: MetricEstimate
    p95_end_to_end_seconds: MetricEstimate
    demand_amplification: MetricEstimate
    secondary_provider_service_share: MetricEstimate
    provider_cost_index: MetricEstimate
    estimated_worker_cost: MetricEstimate
    expected_hard_gate_pass_rate: float
    hard_gate_pass_by_mode: tuple[tuple[FailureMode, float], ...]
    false_failover_rate: float
    missed_outage_rate: float


METRIC_NAMES = ("completion_slo_goodput", "quality_adjusted_completion_goodput", "high_priority_wait_slo_goodput", "worst_workspace_completion_goodput", "p95_end_to_end_seconds", "demand_amplification", "secondary_provider_service_share", "provider_cost_index", "estimated_worker_cost")


def _row_map(rows: Sequence[HierarchicalRetryStateRun]) -> dict[tuple[TenantFairnessScenario, int, FailureMode, RecoveryPolicy], HierarchicalRetryStateRun]:
    return {(row.scenario, row.seed, row.failure_mode, row.policy): row for row in rows}


def _misclassified_policy(failure_mode: FailureMode) -> RecoveryPolicy:
    return RecoveryPolicy.CHECKPOINT_BACKOFF_BUDGET if failure_mode is FailureMode.INDEPENDENT else RecoveryPolicy.CHECKPOINT_IMMEDIATE


def _classification_error(config: FailureClassifierConfig, failure_mode: FailureMode) -> float:
    return config.false_positive_rate if failure_mode is FailureMode.INDEPENDENT else config.false_negative_rate


def _mixed_metric(correct: HierarchicalRetryMetrics, incorrect: HierarchicalRetryMetrics, error_rate: float, name: str) -> float:
    return (1 - error_rate) * float(getattr(correct, name)) + error_rate * float(getattr(incorrect, name))


def revalue_secondary_provider(rows: Sequence[HierarchicalRetryStateRun], *, quality_failure_rate: float, cost_multiplier: float) -> tuple[HierarchicalRetryStateRun, ...]:
    if not 0 <= quality_failure_rate <= 1 or cost_multiplier <= 0:
        raise ValueError("provider quality and cost values are invalid")
    adjusted: list[HierarchicalRetryStateRun] = []
    for row in rows:
        metrics = row.metrics
        quality_goodput = metrics.completion_slo_goodput * (1 - metrics.secondary_provider_service_share * quality_failure_rate)
        provider_cost_index = metrics.demand_amplification * (1 + metrics.secondary_provider_service_share * (cost_multiplier - 1))
        adjusted.append(replace(row, metrics=replace(metrics, quality_adjusted_completion_goodput=quality_goodput, provider_cost_index=provider_cost_index)))
    return tuple(adjusted)


def summarize_failure_classifier(success_rows: Sequence[HierarchicalRetryStateRun], failure_rows: Sequence[HierarchicalRetryStateRun], classifier_config: FailureClassifierConfig, scale_success_probability: float) -> FailureClassifierSummary:
    if not 0 <= scale_success_probability <= 1:
        raise ValueError("scale success probability must be within [0, 1]")
    success = _row_map(success_rows)
    failure = _row_map(failure_rows)
    base_keys = sorted({(row.scenario, row.seed, row.failure_mode) for row in success_rows if row.policy is RecoveryPolicy.FAILURE_AWARE}, key=lambda key: (key[0].value, key[1], key[2].value))
    if not base_keys:
        raise ValueError("failure-aware counterfactual rows are required")
    metric_values: dict[str, list[float]] = {name: [] for name in METRIC_NAMES}
    gate_values: list[tuple[FailureMode, float]] = []
    for scenario, seed, failure_mode in base_keys:
        wrong_policy = _misclassified_policy(failure_mode)
        error_rate = _classification_error(classifier_config, failure_mode)
        key_correct = (scenario, seed, failure_mode, RecoveryPolicy.FAILURE_AWARE)
        key_wrong = (scenario, seed, failure_mode, wrong_policy)
        if key_correct not in success or key_wrong not in success or key_correct not in failure or key_wrong not in failure:
            raise ValueError("counterfactual policy rows are incomplete")
        correct_success = success[key_correct].metrics
        wrong_success = success[key_wrong].metrics
        correct_failure = failure[key_correct].metrics
        wrong_failure = failure[key_wrong].metrics
        for name in METRIC_NAMES:
            success_value = _mixed_metric(correct_success, wrong_success, error_rate, name)
            failure_value = _mixed_metric(correct_failure, wrong_failure, error_rate, name)
            metric_values[name].append(scale_success_probability * success_value + (1 - scale_success_probability) * failure_value)
        success_gate = (1 - error_rate) * float(_hard_gate(correct_success)) + error_rate * float(_hard_gate(wrong_success))
        failure_gate = (1 - error_rate) * float(_hard_gate(correct_failure)) + error_rate * float(_hard_gate(wrong_failure))
        gate_values.append((failure_mode, scale_success_probability * success_gate + (1 - scale_success_probability) * failure_gate))
    gate_by_mode = tuple((failure_mode, sum(value for mode, value in gate_values if mode is failure_mode) / sum(mode is failure_mode for mode, _ in gate_values)) for failure_mode in FailureMode)
    overall_gate = sum(value for _, value in gate_values) / len(gate_values)
    mode_count = len(FailureMode)
    return FailureClassifierSummary(classifier_config=classifier_config, completion_slo_goodput=_estimate(metric_values["completion_slo_goodput"]), quality_adjusted_completion_goodput=_estimate(metric_values["quality_adjusted_completion_goodput"]), high_priority_wait_slo_goodput=_estimate(metric_values["high_priority_wait_slo_goodput"]), worst_workspace_completion_goodput=_estimate(metric_values["worst_workspace_completion_goodput"]), p95_end_to_end_seconds=_estimate(metric_values["p95_end_to_end_seconds"]), demand_amplification=_estimate(metric_values["demand_amplification"]), secondary_provider_service_share=_estimate(metric_values["secondary_provider_service_share"]), provider_cost_index=_estimate(metric_values["provider_cost_index"]), estimated_worker_cost=_estimate(metric_values["estimated_worker_cost"]), expected_hard_gate_pass_rate=overall_gate, hard_gate_pass_by_mode=gate_by_mode, false_failover_rate=classifier_config.false_positive_rate / mode_count, missed_outage_rate=classifier_config.false_negative_rate / mode_count)


def run_failure_classifier_experiment(*, classifier_config: FailureClassifierConfig | None = None, hierarchical_config: HierarchicalConfig | None = None, retry_config: HierarchicalRetryConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), scenarios: Sequence[TenantFairnessScenario] = tuple(TenantFairnessScenario), state_rows: tuple[Sequence[HierarchicalRetryStateRun], Sequence[HierarchicalRetryStateRun]] | None = None) -> FailureClassifierSummary:
    selected_classifier = classifier_config or FailureClassifierConfig()
    selected_retry = retry_config or HierarchicalRetryConfig()
    policies = (RecoveryPolicy.FAILURE_AWARE, RecoveryPolicy.CHECKPOINT_BACKOFF_BUDGET, RecoveryPolicy.CHECKPOINT_IMMEDIATE)
    success_rows, failure_rows = state_rows or generate_hierarchical_retry_rows(hierarchical_config=hierarchical_config, retry_config=selected_retry, seeds=seeds, scenarios=scenarios, policies=policies)
    return summarize_failure_classifier(success_rows, failure_rows, selected_classifier, selected_retry.scale_success_probability)
