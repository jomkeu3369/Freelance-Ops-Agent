from __future__ import annotations

import sys
from pathlib import Path

import matplotlib.pyplot as plt
import streamlit as st

AGENT_ROOT = Path(__file__).resolve().parents[2]
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from tests.runtime_predictor_prototype.scheduler_evaluation import SchedulerSLO, evaluation_rows, run_multidimensional_evaluation  # noqa: E402
from tests.runtime_predictor_prototype.overload_simulation import ADMISSION_LABELS, AdmissionConfig, run_admission_benchmark  # noqa: E402
from tests.runtime_predictor_prototype.scheduler_simulation import POLICY_LABELS, SchedulerExperimentConfig, SchedulingPolicy, generate_scheduler_workload, run_policy_comparison  # noqa: E402


@st.cache_data(show_spinner=False)
def cached_evaluation(workspace_count: int, tasks_per_workspace: int, worker_count: int, mean_interarrival_seconds: float, burst_workspace_multiplier: float, latency_drift: float, prediction_noise: float, cache_hit_rate: float, max_wait_seconds: float, aging_rate: float, aging_overdue_interval: int, training_samples: int, p95_wait_slo: float, maximum_wait_slo: float, fairness_slo: float, wait_violation_rate_slo: float, priority_wait_slo: float, priority_violation_rate_slo: float, seeds: tuple[int, ...]):
    config = SchedulerExperimentConfig(workspace_count=workspace_count, tasks_per_workspace=tasks_per_workspace, worker_count=worker_count, mean_interarrival_seconds=mean_interarrival_seconds, burst_workspace_multiplier=burst_workspace_multiplier, latency_drift=latency_drift, prediction_noise=prediction_noise, cache_hit_rate=cache_hit_rate, max_wait_seconds=max_wait_seconds, aging_rate=aging_rate, aging_overdue_interval=aging_overdue_interval, training_samples=training_samples)
    slo = SchedulerSLO(p95_wait_seconds=p95_wait_slo, maximum_wait_seconds=maximum_wait_slo, fairness_index=fairness_slo, wait_slo_seconds=p95_wait_slo, wait_violation_rate=wait_violation_rate_slo, high_priority_wait_seconds=priority_wait_slo, high_priority_violation_rate=priority_violation_rate_slo)
    return run_multidimensional_evaluation(config, slo=slo, seeds=seeds)


@st.cache_data(show_spinner=False)
def cached_single_seed(workspace_count: int, tasks_per_workspace: int, worker_count: int, mean_interarrival_seconds: float, burst_workspace_multiplier: float, latency_drift: float, prediction_noise: float, cache_hit_rate: float, max_wait_seconds: float, aging_rate: float, aging_overdue_interval: int, training_samples: int, seed: int):
    config = SchedulerExperimentConfig(workspace_count=workspace_count, tasks_per_workspace=tasks_per_workspace, worker_count=worker_count, mean_interarrival_seconds=mean_interarrival_seconds, burst_workspace_multiplier=burst_workspace_multiplier, latency_drift=latency_drift, prediction_noise=prediction_noise, cache_hit_rate=cache_hit_rate, max_wait_seconds=max_wait_seconds, aging_rate=aging_rate, aging_overdue_interval=aging_overdue_interval, training_samples=training_samples)
    tasks, prediction_metrics = generate_scheduler_workload(config, random_seed=seed)
    return tasks, prediction_metrics, run_policy_comparison(tasks, worker_count=worker_count, max_wait_seconds=max_wait_seconds, aging_rate=aging_rate, aging_overdue_interval=aging_overdue_interval)


@st.cache_data(show_spinner=False)
def cached_admission_benchmark(workspace_count: int, tasks_per_workspace: int, worker_count: int, mean_interarrival_seconds: float, burst_workspace_multiplier: float, latency_drift: float, prediction_noise: float, cache_hit_rate: float, max_wait_seconds: float, aging_rate: float, aging_overdue_interval: int, training_samples: int, max_active_drain_seconds: float, max_defer_seconds: float, emergency_drain_seconds: float, completion_slo_seconds: float, seeds: tuple[int, ...]):
    config = SchedulerExperimentConfig(workspace_count=workspace_count, tasks_per_workspace=tasks_per_workspace, worker_count=worker_count, mean_interarrival_seconds=mean_interarrival_seconds, burst_workspace_multiplier=burst_workspace_multiplier, latency_drift=latency_drift, prediction_noise=prediction_noise, cache_hit_rate=cache_hit_rate, max_wait_seconds=max_wait_seconds, aging_rate=aging_rate, aging_overdue_interval=aging_overdue_interval, training_samples=training_samples)
    admission_config = AdmissionConfig(max_active_drain_seconds=max_active_drain_seconds, max_defer_seconds=max_defer_seconds, emergency_drain_seconds=emergency_drain_seconds, completion_slo_seconds=completion_slo_seconds)
    return run_admission_benchmark(config, admission_config=admission_config, seeds=seeds)


def _evaluation_figure(evaluation):
    labels = [POLICY_LABELS[summary.policy] for summary in evaluation.summaries]
    positions = list(range(len(labels)))
    figure, axes = plt.subplots(2, 3, figsize=(16, 9), constrained_layout=True)
    panels = [(axes[0, 0], "Mean completion", "Seconds", [summary.mean_completion_seconds.mean for summary in evaluation.summaries], [summary.mean_completion_seconds.ci95 for summary in evaluation.summaries], None), (axes[0, 1], "P95 queue wait", "Seconds", [summary.p95_wait_seconds.mean for summary in evaluation.summaries], [summary.p95_wait_seconds.ci95 for summary in evaluation.summaries], evaluation.slo.p95_wait_seconds), (axes[0, 2], "Maximum queue wait", "Seconds", [summary.maximum_wait_seconds.mean for summary in evaluation.summaries], [summary.maximum_wait_seconds.ci95 for summary in evaluation.summaries], evaluation.slo.maximum_wait_seconds), (axes[1, 0], "Workspace fairness", "Jain index", [summary.fairness_index.mean for summary in evaluation.summaries], [summary.fairness_index.ci95 for summary in evaluation.summaries], evaluation.slo.fairness_index), (axes[1, 1], "Wait violations", "Percent", [100 * summary.wait_violation_rate.mean for summary in evaluation.summaries], [100 * summary.wait_violation_rate.ci95 for summary in evaluation.summaries], 100 * evaluation.slo.wait_violation_rate), (axes[1, 2], "Priority violations", "Percent", [100 * summary.high_priority_violation_rate.mean for summary in evaluation.summaries], [100 * summary.high_priority_violation_rate.ci95 for summary in evaluation.summaries], 100 * evaluation.slo.high_priority_violation_rate)]
    for axis, title, ylabel, values, errors, threshold in panels:
        axis.bar(positions, values, yerr=errors, capsize=4, color=["tab:gray", "tab:orange", "tab:red", "tab:blue", "tab:green", "tab:olive", "tab:purple"])
        if threshold is not None:
            axis.axhline(threshold, color="black", linestyle="--", linewidth=1.2)
        axis.set_xticks(positions, labels, rotation=18, ha="right")
        axis.set_title(title)
        axis.set_ylabel(ylabel)
        axis.grid(axis="y", alpha=0.25)
    return figure


def _workspace_figure(result):
    labels = [metric.workspace_id for metric in result.workspace_metrics]
    values = [metric.mean_wait_seconds for metric in result.workspace_metrics]
    figure, axis = plt.subplots(figsize=(11, 4.5), constrained_layout=True)
    axis.bar(labels, values, color="tab:blue")
    axis.set_title(f"{POLICY_LABELS[result.policy]} · mean wait by workspace")
    axis.set_ylabel("Seconds")
    axis.tick_params(axis="x", rotation=30)
    axis.grid(axis="y", alpha=0.25)
    return figure


def _admission_rows(benchmark) -> list[dict[str, object]]:
    return [{"Policy": ADMISSION_LABELS[summary.policy], "Admitted (%)": round(100 * summary.admitted_rate.mean, 1), "Deferred (%)": round(100 * summary.deferred_rate.mean, 1), "Rejected (%)": round(100 * summary.rejected_rate.mean, 1), "P95 end-to-end (sec)": round(summary.p95_end_to_end_seconds.mean, 1), "P99 end-to-end (sec)": round(summary.p99_end_to_end_seconds.mean, 1), "SLO goodput (%)": round(100 * summary.completion_slo_rate.mean, 1), "Priority 4-5 accepted (%)": round(100 * summary.high_priority_acceptance_rate.mean, 1), "Recovery (sec)": round(summary.recovery_after_last_arrival_seconds.mean, 1)} for summary in benchmark.summaries]


def _admission_figure(benchmark):
    labels = [ADMISSION_LABELS[summary.policy] for summary in benchmark.summaries]
    positions = list(range(len(labels)))
    figure, axes = plt.subplots(2, 2, figsize=(13, 9), constrained_layout=True)
    panels = ((axes[0, 0], "P95 end-to-end", "Seconds", [summary.p95_end_to_end_seconds.mean for summary in benchmark.summaries]), (axes[0, 1], "SLO goodput", "Submitted tasks (%)", [100 * summary.completion_slo_rate.mean for summary in benchmark.summaries]), (axes[1, 0], "Rejected tasks", "Submitted tasks (%)", [100 * summary.rejected_rate.mean for summary in benchmark.summaries]), (axes[1, 1], "Recovery after final arrival", "Seconds", [summary.recovery_after_last_arrival_seconds.mean for summary in benchmark.summaries]))
    for axis, title, ylabel, values in panels:
        axis.bar(positions, values, color=["tab:gray", "tab:blue", "tab:orange", "tab:green"])
        axis.set_xticks(positions, labels, rotation=18, ha="right")
        axis.set_title(title)
        axis.set_ylabel(ylabel)
        axis.grid(axis="y", alpha=0.25)
    return figure


st.set_page_config(page_title="Runtime-aware Scheduler Lab", layout="wide")
st.title("Runtime-aware multi-workspace Scheduler Lab")
st.caption("FIFO, workspace fairness, Predicted-SJF, Aging and Oracle-SJF are replayed on the same synthetic task stream.")

with st.sidebar:
    st.header("Workload")
    workspace_count = st.slider("Workspaces", 2, 12, 6, 1)
    tasks_per_workspace = st.slider("Tasks per workspace", 10, 200, 60, 10)
    worker_count = st.slider("Workers", 1, 16, 6, 1)
    mean_interarrival_seconds = st.slider("Mean interarrival (sec)", 1.0, 60.0, 25.0, 0.5)
    burst_workspace_multiplier = st.slider("Workspace #1 burst multiplier", 1.0, 8.0, 3.0, 0.5)
    cache_hit_rate = st.slider("Cache hit rate", 0.0, 0.8, 0.1, 0.05)
    st.header("Prediction")
    latency_drift = st.slider("Latency drift", 0.0, 1.0, 0.3, 0.05)
    prediction_noise = st.slider("Additional prediction noise", 0.0, 1.0, 0.0, 0.05)
    training_samples = st.slider("Predictor training samples", 300, 5_000, 2_000, 100)
    st.header("Scheduler guardrails")
    max_wait_seconds = st.slider("Maximum wait target (sec)", 10.0, 600.0, 120.0, 10.0)
    aging_rate = st.slider("Aging rate", 0.0, 0.1, 0.02, 0.005)
    aging_overdue_interval = st.slider("Overdue lane interval", 1, 12, 4, 1)
    st.header("Selection SLO")
    p95_wait_slo = st.slider("P95 wait SLO (sec)", 10.0, 600.0, 120.0, 10.0)
    maximum_wait_slo = st.slider("Maximum wait SLO (sec)", 30.0, 1_800.0, 300.0, 30.0)
    fairness_slo = st.slider("Minimum fairness", 0.5, 1.0, 0.9, 0.01)
    wait_violation_rate_slo = st.slider("Allowed wait violations", 0.0, 0.2, 0.01, 0.01)
    priority_wait_slo = st.slider("Priority 4-5 wait SLO (sec)", 10.0, 600.0, 60.0, 10.0)
    priority_violation_rate_slo = st.slider("Allowed priority violations", 0.0, 0.2, 0.01, 0.01)
    st.header("Overload admission")
    max_active_drain_seconds = st.slider("Active drain target (sec)", 30.0, 600.0, 120.0, 30.0)
    max_defer_seconds = st.slider("Maximum defer (sec)", 60.0, 1_800.0, 600.0, 60.0)
    emergency_drain_seconds = st.slider("Emergency drain limit (sec)", max_active_drain_seconds, 1_200.0, max(300.0, max_active_drain_seconds), 30.0)
    completion_slo_seconds = st.slider("Completion SLO (sec)", 30.0, 1_200.0, 300.0, 30.0)
    seed_count = st.slider("Repeated seeds", 1, 10, 5, 1)
    base_seed = st.number_input("Base seed", min_value=0, value=42, step=1)
    run_clicked = st.button("Run benchmark", type="primary", width="stretch")

parameters = (workspace_count, tasks_per_workspace, worker_count, mean_interarrival_seconds, burst_workspace_multiplier, latency_drift, prediction_noise, cache_hit_rate, max_wait_seconds, aging_rate, aging_overdue_interval, training_samples)
evaluation_parameters = (*parameters, p95_wait_slo, maximum_wait_slo, fairness_slo, wait_violation_rate_slo, priority_wait_slo, priority_violation_rate_slo)
selected_seeds = tuple(int(base_seed) + index * 17 for index in range(seed_count))
if run_clicked or "scheduler_evaluation" not in st.session_state:
    with st.spinner("Training predictors and replaying scheduler policies..."):
        st.session_state.scheduler_evaluation = cached_evaluation(*evaluation_parameters, selected_seeds)
        st.session_state.scheduler_single = cached_single_seed(*parameters, int(base_seed))

evaluation = st.session_state.scheduler_evaluation
tasks, prediction_metrics, comparison = st.session_state.scheduler_single
metric_columns = st.columns(5)
metric_columns[0].metric("Prediction MAE", f"{evaluation.prediction_mae_seconds.mean:.2f} sec")
metric_columns[1].metric("Prediction RMSE", f"{evaluation.prediction_rmse_seconds.mean:.2f} sec")
metric_columns[2].metric("Prediction R²", f"{evaluation.prediction_r2.mean:.3f}")
metric_columns[3].metric("Tasks per replay", len(tasks))
metric_columns[4].metric("Offered load", f"{evaluation.offered_load_ratio.mean:.2f}")
if evaluation.offered_load_ratio.mean > 1.1:
    st.warning("Offered load is above worker capacity. Queue growth and max-wait violations are expected; compare policies as an overload stress test.")
elif evaluation.offered_load_ratio.mean >= 0.8:
    st.info("Offered load is close to worker capacity. This is the most sensitive range for comparing queue policies.")
else:
    st.success("Offered load is below worker capacity. Queue wait should remain bounded unless burst traffic dominates.")

st.subheader("SLO-gated policy comparison")
if evaluation.selected_policy is None:
    st.error("No operational policy passed every SLO on every repeated seed. Capacity or guardrails must change before choosing a winner.")
else:
    st.success(f"Selected policy: {POLICY_LABELS[evaluation.selected_policy]}")
st.dataframe(evaluation_rows(evaluation), width="stretch", hide_index=True)
evaluation_figure = _evaluation_figure(evaluation)
st.pyplot(evaluation_figure, width="stretch")
plt.close(evaluation_figure)

st.subheader("Workspace-level inspection")
selected_label = st.selectbox("Policy", [POLICY_LABELS[policy] for policy in SchedulingPolicy], index=3)
selected_policy = next(policy for policy in SchedulingPolicy if POLICY_LABELS[policy] == selected_label)
selected_result = comparison[selected_policy]
workspace_figure = _workspace_figure(selected_result)
st.pyplot(workspace_figure, width="stretch")
plt.close(workspace_figure)

st.dataframe([{"Workspace": metric.workspace_id, "Tasks": metric.task_count, "Mean wait (sec)": round(metric.mean_wait_seconds, 2), "P95 wait (sec)": round(metric.p95_wait_seconds, 2), "Mean completion (sec)": round(metric.mean_completion_seconds, 2), "Mean slowdown": round(metric.mean_slowdown, 2)} for metric in selected_result.workspace_metrics], width="stretch", hide_index=True)

st.subheader("Overload admission inspection")
run_overload_study = st.checkbox("Run overload admission comparison", value=False)
if run_overload_study:
    with st.spinner("Applying admission policies to the same workload..."):
        admission_benchmark = cached_admission_benchmark(*parameters, max_active_drain_seconds, max_defer_seconds, emergency_drain_seconds, completion_slo_seconds, selected_seeds)
    st.dataframe(_admission_rows(admission_benchmark), width="stretch", hide_index=True)
    admission_figure = _admission_figure(admission_benchmark)
    st.pyplot(admission_figure, width="stretch")
    plt.close(admission_figure)

st.caption(f"Single-seed prediction metrics: MAE {prediction_metrics[0]:.2f}s · RMSE {prediction_metrics[1]:.2f}s · R² {prediction_metrics[2]:.3f} · offered load {prediction_metrics[3]:.2f}. Cache hits bypass the worker pool and are excluded from predictor updates.")
