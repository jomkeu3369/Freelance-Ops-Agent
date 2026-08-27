from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .failure_classifier_simulation import FailureClassifierConfig, FailureClassifierSummary, revalue_secondary_provider, run_failure_classifier_experiment, summarize_failure_classifier
from .hierarchical_retry_simulation import FailureMode, HierarchicalRetryConfig, RecoveryPolicy, generate_hierarchical_retry_rows


def _mode_gate(summary: FailureClassifierSummary, failure_mode: FailureMode) -> float:
    return dict(summary.hard_gate_pass_by_mode)[failure_mode]


def build_failure_classifier_error_plot(output_path: Path | None = None, *, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), false_negative_rates: tuple[float, ...] = (0.0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50), false_positive_rates: tuple[float, ...] = (0.0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50)) -> tuple[Path, dict[str, object]]:
    policies = [RecoveryPolicy.FAILURE_AWARE, RecoveryPolicy.CHECKPOINT_BACKOFF_BUDGET, RecoveryPolicy.CHECKPOINT_IMMEDIATE]
    success_rows, failure_rows = generate_hierarchical_retry_rows(seeds=seeds, policies=policies)
    fn_summaries = tuple(summarize_failure_classifier(success_rows, failure_rows, FailureClassifierConfig(false_positive_rate=0.05, false_negative_rate=value), 0.90) for value in false_negative_rates)
    fp_summaries = tuple(summarize_failure_classifier(success_rows, failure_rows, FailureClassifierConfig(false_positive_rate=value, false_negative_rate=0.10), 0.90) for value in false_positive_rates)
    grid = np.array([[100 * min(rate for _, rate in summarize_failure_classifier(success_rows, failure_rows, FailureClassifierConfig(false_positive_rate=false_positive, false_negative_rate=false_negative), 0.90).hard_gate_pass_by_mode) for false_negative in false_negative_rates] for false_positive in false_positive_rates])
    figure, axes = plt.subplots(1, 3, figsize=(20, 6.8), constrained_layout=True)
    axes[0].plot(false_negative_rates, [100 * summary.expected_hard_gate_pass_rate for summary in fn_summaries], marker="o", linewidth=2, label="Overall gate")
    axes[0].plot(false_negative_rates, [100 * _mode_gate(summary, FailureMode.PROVIDER_OUTAGE) for summary in fn_summaries], marker="s", linewidth=2, label="Provider-outage gate")
    axes[0].axhline(90.0, color="black", linestyle="--", linewidth=1.1)
    axes[0].set_title("False-negative boundary")
    axes[0].set_xlabel("Outage classified as independent")
    axes[0].set_ylabel("Expected gate pass (%) · higher is better")
    axes[0].legend(loc="lower left")
    axes[1].plot(false_positive_rates, [100 * summary.expected_hard_gate_pass_rate for summary in fp_summaries], marker="o", linewidth=2, label="Overall gate")
    axes[1].plot(false_positive_rates, [100 * _mode_gate(summary, FailureMode.INDEPENDENT) for summary in fp_summaries], marker="s", linewidth=2, label="Independent-failure gate")
    axes[1].axhline(90.0, color="black", linestyle="--", linewidth=1.1)
    axes[1].set_title("False-positive boundary")
    axes[1].set_xlabel("Independent classified as outage")
    axes[1].legend(loc="lower left")
    image = axes[2].imshow(grid, cmap="RdYlGn", vmin=70.0, vmax=100.0, aspect="auto", origin="lower")
    axes[2].set_xticks(np.arange(len(false_negative_rates)), [f"{100 * value:.0f}%" for value in false_negative_rates], rotation=20, ha="right")
    axes[2].set_yticks(np.arange(len(false_positive_rates)), [f"{100 * value:.0f}%" for value in false_positive_rates])
    axes[2].set_xlabel("False-negative rate")
    axes[2].set_ylabel("False-positive rate")
    axes[2].set_title("Minimum failure-mode gate table")
    for row_index in range(grid.shape[0]):
        for column_index in range(grid.shape[1]):
            axes[2].text(column_index, row_index, f"{grid[row_index, column_index]:.1f}%", ha="center", va="center", color="black")
    plt.colorbar(image, ax=axes[2], shrink=0.82)
    for axis in axes[:2]:
        axis.grid(alpha=0.25)
        axis.set_ylim(65.0, 100.0)
    figure.suptitle("Failure classifier robustness · scale success 90% · 3 adversarial scenarios\nOperational target: false negative ≤ 15%, false positive ≤ 10%", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_failure_classifier_error_boundary.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, {"false_negative": fn_summaries, "false_positive": fp_summaries, "grid": grid}


def build_secondary_provider_tradeoff_plot(output_path: Path | None = None, *, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), latency_multipliers: tuple[float, ...] = (1.0, 1.15, 1.30, 1.50, 2.0), quality_failure_rates: tuple[float, ...] = (0.0, 0.02, 0.05, 0.10, 0.20, 0.30, 0.50), cost_multipliers: tuple[float, ...] = (1.0, 1.25, 1.50, 2.0, 3.0)) -> tuple[Path, dict[str, tuple[FailureClassifierSummary, ...]]]:
    policies = [RecoveryPolicy.FAILURE_AWARE, RecoveryPolicy.CHECKPOINT_BACKOFF_BUDGET, RecoveryPolicy.CHECKPOINT_IMMEDIATE]
    base_retry = HierarchicalRetryConfig()
    base_rows = generate_hierarchical_retry_rows(retry_config=base_retry, seeds=seeds, policies=policies)
    latency = tuple(run_failure_classifier_experiment(retry_config=HierarchicalRetryConfig(secondary_provider_latency_multiplier=value), seeds=seeds) for value in latency_multipliers)
    quality = tuple(summarize_failure_classifier(revalue_secondary_provider(base_rows[0], quality_failure_rate=value, cost_multiplier=base_retry.secondary_provider_cost_multiplier), revalue_secondary_provider(base_rows[1], quality_failure_rate=value, cost_multiplier=base_retry.secondary_provider_cost_multiplier), FailureClassifierConfig(), base_retry.scale_success_probability) for value in quality_failure_rates)
    cost = tuple(summarize_failure_classifier(revalue_secondary_provider(base_rows[0], quality_failure_rate=base_retry.secondary_provider_quality_failure_rate, cost_multiplier=value), revalue_secondary_provider(base_rows[1], quality_failure_rate=base_retry.secondary_provider_quality_failure_rate, cost_multiplier=value), FailureClassifierConfig(), base_retry.scale_success_probability) for value in cost_multipliers)
    figure, axes = plt.subplots(1, 3, figsize=(20, 6.5), constrained_layout=True)
    axes[0].plot(latency_multipliers, [100 * summary.quality_adjusted_completion_goodput.mean for summary in latency], marker="o", linewidth=2, label="Quality-adjusted goodput")
    axes[0].plot(latency_multipliers, [100 * summary.worst_workspace_completion_goodput.mean for summary in latency], marker="s", linewidth=2, label="Worst workspace")
    axes[0].plot(latency_multipliers, [100 * _mode_gate(summary, FailureMode.PROVIDER_OUTAGE) for summary in latency], marker="D", linewidth=2, label="Outage gate")
    axes[0].axhline(90.0, color="black", linestyle="--", linewidth=1.1)
    axes[0].set_title("Secondary latency penalty")
    axes[0].set_xlabel("Latency multiplier")
    axes[0].set_ylabel("Rate (%) · higher is better")
    axes[0].legend(loc="lower left", fontsize=8)
    axes[1].plot(quality_failure_rates, [100 * summary.quality_adjusted_completion_goodput.mean for summary in quality], marker="o", linewidth=2, label="Quality-adjusted goodput")
    axes[1].plot(quality_failure_rates, [100 * _mode_gate(summary, FailureMode.PROVIDER_OUTAGE) for summary in quality], marker="D", linewidth=2, label="Outage gate")
    axes[1].axhline(90.0, color="black", linestyle="--", linewidth=1.1)
    axes[1].set_title("Secondary quality-failure penalty")
    axes[1].set_xlabel("Secondary quality failure rate")
    axes[1].legend(loc="lower left", fontsize=8)
    axes[2].plot(cost_multipliers, [summary.provider_cost_index.mean for summary in cost], marker="o", linewidth=2, label="Provider cost index")
    axes[2].axhline(1.20, color="black", linestyle="--", linewidth=1.1, label="Example cost budget")
    axes[2].set_title("Secondary provider price penalty")
    axes[2].set_xlabel("Secondary price multiplier")
    axes[2].set_ylabel("Provider cost / original primary demand")
    axes[2].legend(loc="upper left", fontsize=8)
    for axis in axes:
        axis.grid(alpha=0.25)
    figure.suptitle("Secondary provider operating envelope · classifier FP 5% / FN 10%\nLatency ≤ 1.15× and quality failure ≤ 5% preserve the mode-specific production gate", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_secondary_provider_tradeoff.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, {"latency": latency, "quality": quality, "cost": cost}


def main() -> None:
    classifier_path, classifier = build_failure_classifier_error_plot()
    provider_path, provider = build_secondary_provider_tradeoff_plot()
    baseline = classifier["false_negative"][2]
    print(f"Baseline classifier: completion={100 * baseline.completion_slo_goodput.mean:.2f}%, quality-adjusted={100 * baseline.quality_adjusted_completion_goodput.mean:.2f}%, worst={100 * baseline.worst_workspace_completion_goodput.mean:.2f}%, gate={100 * baseline.expected_hard_gate_pass_rate:.1f}%")
    print(f"Latency 1.30x outage gate: {100 * _mode_gate(provider['latency'][2], FailureMode.PROVIDER_OUTAGE):.1f}%")
    print(f"Quality failure 10% outage gate: {100 * _mode_gate(provider['quality'][3], FailureMode.PROVIDER_OUTAGE):.1f}%")
    print(classifier_path)
    print(provider_path)


if __name__ == "__main__":
    main()
