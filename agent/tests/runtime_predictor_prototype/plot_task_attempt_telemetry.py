from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .task_attempt_telemetry_experiment import FAULT_LABELS, TelemetryDelaySummary, TelemetryIntegrityBenchmark, run_telemetry_delay_benchmark, run_telemetry_integrity_benchmark


def build_task_attempt_telemetry_integrity_table_plot(output_path: Path | None = None, *, benchmark: TelemetryIntegrityBenchmark | None = None, seeds: tuple[int, ...] = tuple(range(20)), task_count: int = 60) -> tuple[Path, TelemetryIntegrityBenchmark]:
    selected = benchmark or run_telemetry_integrity_benchmark(seeds=seeds, task_count=task_count)
    values = np.array([[100 * float(summary.expected_valid), 100 * summary.observed_valid_rate, 100 * summary.correct_behavior_rate, 100 * summary.reconstructed_attempt_rate.mean] for summary in selected.summaries])
    row_labels = [FAULT_LABELS[summary.fault] for summary in selected.summaries]
    column_labels = ("Expected accepted", "Observed accepted", "Correct behavior", "Replay fidelity")
    figure, axis = plt.subplots(figsize=(14, 10), constrained_layout=True)
    image = axis.imshow(values, cmap="RdYlGn", vmin=0.0, vmax=100.0, aspect="auto")
    axis.set_xticks(np.arange(len(column_labels)), column_labels, rotation=15, ha="right")
    axis.set_yticks(np.arange(len(row_labels)), row_labels)
    for row_index in range(values.shape[0]):
        for column_index in range(values.shape[1]):
            axis.text(column_index, row_index, f"{values[row_index, column_index]:.1f}%", ha="center", va="center", color="black")
    plt.colorbar(image, ax=axis, shrink=0.82, label="Rate (%)")
    gate = "PASS" if selected.contract_gate_passed else "FAIL"
    figure.suptitle(f"TaskAttempt telemetry integrity table · {len(seeds)} seeds × {task_count} tasks\nContract gate: {gate} · invalid streams never enter counterfactual replay", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_task_attempt_telemetry_integrity_table.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def build_task_attempt_telemetry_delay_plot(output_path: Path | None = None, *, summaries: tuple[TelemetryDelaySummary, ...] | None = None, delays: tuple[float, ...] = (0.0, 10.0, 30.0, 60.0, 180.0, 300.0, 301.0, 600.0), seeds: tuple[int, ...] = tuple(range(10)), task_count: int = 30) -> tuple[Path, tuple[TelemetryDelaySummary, ...]]:
    selected = summaries or run_telemetry_delay_benchmark(delays=delays, seeds=seeds, task_count=task_count)
    x_values = [summary.delay_seconds for summary in selected]
    figure, axes = plt.subplots(1, 3, figsize=(20, 6.2), constrained_layout=True)
    axes[0].plot(x_values, [100 * summary.valid_rate for summary in selected], marker="o", linewidth=2)
    axes[0].axhline(100.0, color="black", linestyle="--", linewidth=1.0, label="Replay gate")
    axes[0].set_title("Replay acceptance")
    axes[0].set_ylabel("Accepted datasets (%) · higher is better")
    axes[0].legend(loc="lower left")
    axes[1].plot(x_values, [100 * summary.warning_event_rate for summary in selected], marker="s", linewidth=2, color="tab:orange")
    axes[1].set_title("Delayed-event warning coverage")
    axes[1].set_ylabel("Events warned (%)")
    axes[2].plot(x_values, [summary.mean_error_count for summary in selected], marker="D", linewidth=2, color="tab:red")
    axes[2].set_title("Hard validation errors")
    axes[2].set_ylabel("Mean errors per dataset")
    for axis in axes:
        axis.axvline(30.0, color="black", linestyle=":", linewidth=1.0, label="Warning >30s")
        axis.axvline(300.0, color="black", linestyle="--", linewidth=1.0, label="Reject >300s")
        axis.set_xlabel("Event ingestion delay (seconds)")
        axis.grid(alpha=0.25)
    axes[2].legend(loc="upper left", fontsize=8)
    figure.suptitle("TaskAttempt telemetry ingestion-delay boundary\nOut-of-order receipt is tolerated by sequence; stale telemetry beyond 300s is rejected", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_task_attempt_telemetry_delay_boundary.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, tuple(selected)


def main() -> None:
    table_path, benchmark = build_task_attempt_telemetry_integrity_table_plot()
    delay_path, delays = build_task_attempt_telemetry_delay_plot()
    for summary in benchmark.summaries:
        print(f"{FAULT_LABELS[summary.fault]}: expected accepted={summary.expected_valid}, observed accepted={100 * summary.observed_valid_rate:.1f}%, correct={100 * summary.correct_behavior_rate:.1f}%, replay fidelity={100 * summary.reconstructed_attempt_rate.mean:.1f}%")
    print(f"Contract gate: {'PASS' if benchmark.contract_gate_passed else 'FAIL'}")
    for summary in delays:
        print(f"Delay {summary.delay_seconds:.0f}s: valid={100 * summary.valid_rate:.1f}%, warned events={100 * summary.warning_event_rate:.1f}%, mean errors={summary.mean_error_count:.1f}")
    print(table_path)
    print(delay_path)


if __name__ == "__main__":
    main()
