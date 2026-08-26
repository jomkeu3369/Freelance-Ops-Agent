from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .scheduler_evaluation import OPERATIONAL_POLICIES, MultiDimensionalEvaluation, PolicyEvaluationSummary, SchedulerSLO, run_multidimensional_evaluation
from .scheduler_simulation import POLICY_LABELS, SchedulerExperimentConfig


POLICY_COLORS = ("tab:gray", "tab:orange", "tab:red", "tab:blue", "tab:green", "tab:olive", "tab:purple")


def _metric_panel(axis: plt.Axes, summaries: tuple[PolicyEvaluationSummary, ...], title: str, ylabel: str, metric_name: str, *, threshold: float | None = None, percent: bool = False) -> None:
    labels = [POLICY_LABELS[summary.policy] for summary in summaries]
    estimates = [getattr(summary, metric_name) for summary in summaries]
    multiplier = 100 if percent else 1
    values = [estimate.mean * multiplier for estimate in estimates]
    errors = [estimate.ci95 * multiplier for estimate in estimates]
    positions = np.arange(len(labels))
    axis.bar(positions, values, yerr=errors, capsize=3, color=POLICY_COLORS)
    if threshold is not None:
        axis.axhline(threshold * multiplier, color="black", linestyle="--", linewidth=1.3, label="SLO")
        axis.legend(loc="upper left")
    axis.set_xticks(positions, labels, rotation=24, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_multidimensional_evaluation_plot(output_path: Path | None = None, *, config: SchedulerExperimentConfig | None = None, slo: SchedulerSLO | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, MultiDimensionalEvaluation]:
    selected_config = config or SchedulerExperimentConfig()
    selected_slo = slo or SchedulerSLO()
    evaluation = run_multidimensional_evaluation(selected_config, slo=selected_slo, seeds=seeds)
    figure, axes = plt.subplots(2, 3, figsize=(20, 12), constrained_layout=True)
    summaries = evaluation.summaries
    _metric_panel(axes[0, 0], summaries, "Mean completion time", "Seconds · lower is better", "mean_completion_seconds")
    _metric_panel(axes[0, 1], summaries, "P95 queue wait", "Seconds · lower is better", "p95_wait_seconds", threshold=selected_slo.p95_wait_seconds)
    _metric_panel(axes[0, 2], summaries, "Maximum queue wait", "Seconds · lower is better", "maximum_wait_seconds", threshold=selected_slo.maximum_wait_seconds)
    _metric_panel(axes[1, 0], summaries, "Workspace slowdown equality", "Jain index · higher is better", "fairness_index", threshold=selected_slo.fairness_index)
    _metric_panel(axes[1, 1], summaries, f"Wait violations above {selected_slo.wait_slo_seconds:.0f}s", "Tasks (%) · lower is better", "wait_violation_rate", threshold=selected_slo.wait_violation_rate, percent=True)
    _metric_panel(axes[1, 2], summaries, f"Priority 4-5 violations above {selected_slo.high_priority_wait_seconds:.0f}s", "High-priority tasks (%) · lower is better", "high_priority_violation_rate", threshold=selected_slo.high_priority_violation_rate, percent=True)
    decision = "No operational policy passes every SLO on every seed" if evaluation.selected_policy is None else f"Selected: {POLICY_LABELS[evaluation.selected_policy]}"
    figure.suptitle(f"Scheduler multi-dimensional SLO evaluation · load {evaluation.offered_load_ratio.mean:.2f} · {len(seeds)} paired seeds\n{decision}", fontsize=15)
    destination = output_path or Path(__file__).with_name("scheduler_multidimensional_evaluation.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, evaluation


def build_slo_stress_heatmap(output_path: Path | None = None, *, slo: SchedulerSLO | None = None, seeds: tuple[int, ...] = (11, 23, 42)) -> tuple[Path, dict[str, MultiDimensionalEvaluation]]:
    selected_slo = slo or SchedulerSLO()
    base = SchedulerExperimentConfig(tasks_per_workspace=60, training_samples=1_200)
    scenarios = {"Under capacity": replace(base, mean_interarrival_seconds=40.0), "Near capacity": replace(base, mean_interarrival_seconds=25.0), "Prediction noise": replace(base, mean_interarrival_seconds=25.0, prediction_noise=0.6), "High cache hit": replace(base, mean_interarrival_seconds=25.0, cache_hit_rate=0.5), "Overloaded": replace(base, mean_interarrival_seconds=12.0)}
    evaluations = {name: run_multidimensional_evaluation(config, slo=selected_slo, seeds=seeds) for name, config in scenarios.items()}
    criteria = np.array([[next(summary for summary in evaluation.summaries if summary.policy is policy).passed_criteria.mean for name, evaluation in evaluations.items()] for policy in OPERATIONAL_POLICIES])
    pass_rates = np.array([[100 * next(summary for summary in evaluation.summaries if summary.policy is policy).slo_pass_rate for name, evaluation in evaluations.items()] for policy in OPERATIONAL_POLICIES])
    figure, axes = plt.subplots(1, 2, figsize=(18, 7), constrained_layout=True)
    panels = ((axes[0], criteria, "Average SLO criteria passed", "Criteria out of 5", 0, 5, ".1f"), (axes[1], pass_rates, "Runs passing every SLO", "Percent of seeds", 0, 100, ".0f"))
    for axis, values, title, colorbar_label, minimum, maximum, value_format in panels:
        image = axis.imshow(values, cmap="RdYlGn", vmin=minimum, vmax=maximum, aspect="auto")
        axis.set_xticks(np.arange(len(scenarios)), list(scenarios), rotation=20, ha="right")
        axis.set_yticks(np.arange(len(OPERATIONAL_POLICIES)), [POLICY_LABELS[policy] for policy in OPERATIONAL_POLICIES])
        axis.set_title(title)
        for row_index in range(values.shape[0]):
            for column_index in range(values.shape[1]):
                suffix = "%" if maximum == 100 else "/5"
                axis.text(column_index, row_index, f"{values[row_index, column_index]:{value_format}}{suffix}", ha="center", va="center", color="black")
        figure.colorbar(image, ax=axis, label=colorbar_label, shrink=0.85)
    loads = ", ".join(f"{name}={evaluation.offered_load_ratio.mean:.2f}" for name, evaluation in evaluations.items())
    figure.suptitle(f"Scheduler SLO robustness across load and prediction conditions · {len(seeds)} paired seeds\nOffered load: {loads}", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_slo_stress_heatmap.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, evaluations


def main() -> None:
    plot_path, evaluation = build_multidimensional_evaluation_plot()
    print(f"Prediction MAE: {evaluation.prediction_mae_seconds.mean:.2f}s")
    print(f"Offered load: {evaluation.offered_load_ratio.mean:.2f}")
    for summary in evaluation.summaries:
        print(f"{POLICY_LABELS[summary.policy]}: completion={summary.mean_completion_seconds.mean:.2f}s, p95={summary.p95_wait_seconds.mean:.2f}s, p99={summary.p99_wait_seconds.mean:.2f}s, max={summary.maximum_wait_seconds.mean:.2f}s, fairness={summary.fairness_index.mean:.3f}, wait violations={100 * summary.wait_violation_rate.mean:.2f}%, priority violations={100 * summary.high_priority_violation_rate.mean:.2f}%, criteria={summary.passed_criteria.mean:.1f}/5, pass rate={100 * summary.slo_pass_rate:.1f}%")
    print(f"Selected policy: {POLICY_LABELS[evaluation.selected_policy] if evaluation.selected_policy is not None else 'none'}")
    print(plot_path)
    heatmap_path, evaluations = build_slo_stress_heatmap()
    for name, scenario in evaluations.items():
        selected = POLICY_LABELS[scenario.selected_policy] if scenario.selected_policy is not None else "none"
        print(f"{name}: load={scenario.offered_load_ratio.mean:.2f}, selected={selected}")
    print(heatmap_path)


if __name__ == "__main__":
    main()
