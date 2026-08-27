from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import matplotlib.pyplot as plt
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .metrics import routing_metrics
from .operational_replay import ROUTES, _portable_path, _read_json

plt.switch_backend("Agg")

Route = Literal["DIRECT_TOOL", "SIMPLE_LLM", "REACT_AGENT", "SUPERVISOR", "HUMAN_REQUIRED"]
CorrectionSource = Literal["HUMAN_REVIEW", "USER_EDIT", "POLICY_REPLAY"]


class ShadowTrace(BaseModel):
    """Privacy-safe join of a route event and a separately reviewed gold label."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0", "1.1"] = "1.0"
    trace_hash: str
    workspace_group_hash: str
    project_group_hash: str | None = None
    occurred_at: datetime
    final_route: Route
    shadow_suggested_route: Route | None = None
    shadow_needs_fallback: bool | None = None
    shadow_fallback_reason: str | None = None
    shadow_fused_share: float | None = Field(default=None, ge=0, le=1)
    shadow_margin: float | None = Field(default=None, ge=0, le=1)
    shadow_lane_agreement: bool | None = None
    gold_route: Route
    correction_source: CorrectionSource
    llm_called: bool
    routing_latency_ms: float = Field(ge=0)
    shadow_latency_ms: float | None = Field(default=None, ge=0)
    routing_input_tokens: int = Field(default=0, ge=0)
    routing_output_tokens: int = Field(default=0, ge=0)
    routing_cost_usd: float = Field(default=0, ge=0)
    policy_code: str | None = None
    sampling_stratum: Literal["natural", "risk"] | None = None
    population_stratum_probability: float | None = Field(default=None, gt=0, le=1)
    review_inclusion_probability: float | None = Field(default=None, gt=0, le=1)
    sample_weight: float = Field(default=1, gt=0)

    @field_validator("trace_hash", "workspace_group_hash", "project_group_hash")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None and (len(value) != 64 or any(character not in "0123456789abcdef" for character in value)):
            raise ValueError("hashes must be lowercase SHA-256 hex")
        return value

    @model_validator(mode="after")
    def validate_sampling_metadata(self) -> ShadowTrace:
        metadata = (
            self.sampling_stratum,
            self.population_stratum_probability,
            self.review_inclusion_probability
        )
        if self.schema_version == "1.1" and any(value is None for value in metadata):
            raise ValueError("schema 1.1 requires complete sampling metadata")
        if any(value is not None for value in metadata) and any(value is None for value in metadata):
            raise ValueError("sampling metadata must be all present or all absent")
        if all(value is None for value in metadata) and not math.isclose(self.sample_weight, 1.0, rel_tol=0, abs_tol=1e-12):
            raise ValueError("sample_weight must be one when sampling metadata is absent")
        if self.review_inclusion_probability is not None and not math.isclose(
            self.sample_weight, 1 / self.review_inclusion_probability, rel_tol=1e-9
        ):
            raise ValueError("sample_weight must equal inverse review inclusion probability")
        return self


def _read_traces(path: Path) -> list[ShadowTrace]:
    traces = [ShadowTrace.model_validate_json(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not traces:
        raise ValueError("shadow trace file is empty")
    hashes = [trace.trace_hash for trace in traces]
    if len(hashes) != len(set(hashes)):
        raise ValueError("trace_hash must be unique")
    return traces


def _group(trace: ShadowTrace) -> str:
    return trace.project_group_hash or trace.workspace_group_hash


def _is_holdout(group_hash: str, holdout_percent: int) -> bool:
    return int(group_hash[:8], 16) % 100 < holdout_percent


def _wilson(successes: float, total: float, z: float = 1.959963984540054) -> dict[str, float]:
    if total == 0:
        return {"successes": successes, "total": total, "estimate": 0.0, "lower": 0.0, "upper": 1.0}
    estimate = successes / total
    denominator = 1 + z * z / total
    centre = estimate + z * z / (2 * total)
    radius = z * math.sqrt(estimate * (1 - estimate) / total + z * z / (4 * total * total))
    return {
        "successes": successes,
        "total": total,
        "estimate": estimate,
        "lower": (centre - radius) / denominator,
        "upper": (centre + radius) / denominator
    }


def _prediction(trace: ShadowTrace, mode: str) -> tuple[str, bool, float, float]:
    if trace.policy_code is not None:
        return trace.final_route, False, 0.0, trace.routing_latency_ms
    accepts_shadow = trace.shadow_suggested_route is not None and (
        mode == "shadow_full" or mode == "safe_escalation" and trace.shadow_suggested_route == "HUMAN_REQUIRED"
    )
    if accepts_shadow:
        return str(trace.shadow_suggested_route), False, 0.0, trace.shadow_latency_ms or trace.routing_latency_ms
    return trace.final_route, trace.llm_called, trace.routing_cost_usd, trace.routing_latency_ms


def _sample_weights(traces: list[ShadowTrace]) -> np.ndarray:
    if not all(trace.sampling_stratum is not None and trace.population_stratum_probability is not None for trace in traces):
        return np.ones(len(traces))
    counts = Counter(str(trace.sampling_stratum) for trace in traces)
    probabilities: dict[str, float] = {}
    for trace in traces:
        stratum = str(trace.sampling_stratum)
        probability = float(trace.population_stratum_probability)
        if stratum in probabilities and not math.isclose(probabilities[stratum], probability, rel_tol=0, abs_tol=1e-12):
            raise ValueError("population stratum probability must be constant within a trace set")
        probabilities[stratum] = probability
    if not math.isclose(sum(probabilities.values()), 1.0, rel_tol=0, abs_tol=1e-9):
        raise ValueError("population stratum probabilities must sum to one")
    return np.asarray([probabilities[str(trace.sampling_stratum)] / counts[str(trace.sampling_stratum)] for trace in traces])


def _effective_sample_size(weights: np.ndarray) -> float:
    return float(weights.sum() ** 2 / np.square(weights).sum())


def _weighted_quantile(values: list[float], weights: np.ndarray, quantile: float) -> float:
    order = np.argsort(values)
    sorted_values = np.asarray(values)[order]
    cumulative = np.cumsum(weights[order])
    return float(sorted_values[np.searchsorted(cumulative, quantile * cumulative[-1], side="left")])


def _evaluate(name: str, mode: str, traces: list[ShadowTrace]) -> dict[str, Any]:
    truth = [trace.gold_route for trace in traces]
    weights = _sample_weights(traces)
    decisions = [_prediction(trace, mode) if mode != "actual" else (trace.final_route, trace.llm_called, trace.routing_cost_usd, trace.routing_latency_ms) for trace in traces]
    predictions = [decision[0] for decision in decisions]
    metrics = routing_metrics(truth, predictions, ROUTES, weights)
    human_mask = np.asarray([route == "HUMAN_REQUIRED" for route in truth])
    human_correct_mask = np.asarray([expected == predicted == "HUMAN_REQUIRED" for expected, predicted in zip(truth, predictions)])
    human_total = float(weights[human_mask].sum())
    non_human_total = float(weights[~human_mask].sum())
    human_correct = float(weights[human_correct_mask].sum())
    false_automation = human_total - human_correct
    effective_samples = _effective_sample_size(weights)
    human_effective_samples = _effective_sample_size(weights[human_mask]) if human_mask.any() else 0.0
    route_counts = {route: float(weights[np.asarray([value == route for value in truth])].sum()) for route in ROUTES}
    raw_route_counts = Counter(truth)
    minimum_route_f1 = min(float(metrics["per_route"][route]["f1-score"]) for route in ROUTES)
    weighted_cost = float(np.average([decision[2] for decision in decisions], weights=weights))
    latency = [decision[3] for decision in decisions]
    return {
        "name": name,
        "mode": mode,
        "sample_count": len(traces),
        "effective_sample_size": effective_samples,
        "accuracy": float(metrics["accuracy"]),
        "accuracy_ci95": _wilson(float(metrics["accuracy"]) * effective_samples, effective_samples),
        "macro_f1": float(metrics["macro_f1"]),
        "minimum_route_f1": minimum_route_f1,
        "human_required_recall": human_correct / human_total if human_total else 0.0,
        "human_required_recall_ci95": _wilson((human_correct / human_total) * human_effective_samples, human_effective_samples) if human_total else _wilson(0, 0),
        "false_automation_count": sum(expected == "HUMAN_REQUIRED" and predicted != "HUMAN_REQUIRED" for expected, predicted in zip(truth, predictions)),
        "false_automation_weighted_rate": false_automation / human_total if human_total else 0.0,
        "false_automation_rate_ci95": _wilson((false_automation / human_total) * human_effective_samples, human_effective_samples) if human_total else _wilson(0, 0),
        "over_escalation_count": sum(expected != "HUMAN_REQUIRED" and predicted == "HUMAN_REQUIRED" for expected, predicted in zip(truth, predictions)),
        "over_escalation_weighted_rate": float(weights[np.asarray([expected != "HUMAN_REQUIRED" and predicted == "HUMAN_REQUIRED" for expected, predicted in zip(truth, predictions)])].sum()) / non_human_total if non_human_total else 0.0,
        "llm_call_rate": float(np.average([decision[1] for decision in decisions], weights=weights)),
        "mean_routing_cost_usd": weighted_cost,
        "estimated_cohort_routing_cost_usd": weighted_cost * len(traces),
        "mean_routing_latency_ms": float(np.average(latency, weights=weights)),
        "p95_routing_latency_ms": _weighted_quantile(latency, weights, 0.95),
        "route_counts": dict(raw_route_counts),
        "traffic_route_share": route_counts,
        "sampling_weighted": not np.allclose(weights, weights[0])
    }


def _promotion_gate(metric: dict[str, Any], traces: list[ShadowTrace]) -> dict[str, Any]:
    group_count = len({_group(trace) for trace in traces})
    route_counts = Counter(trace.gold_route for trace in traces)
    checks = {
        "human_review_only": all(trace.correction_source == "HUMAN_REVIEW" for trace in traces),
        "post_stratification_available": all(trace.sampling_stratum is not None and trace.population_stratum_probability is not None and trace.review_inclusion_probability is not None for trace in traces),
        "minimum_effective_samples_1000": metric["effective_sample_size"] >= 1_000,
        "minimum_groups_50": group_count >= 50,
        "minimum_100_per_route": all(route_counts[route] >= 100 for route in ROUTES),
        "macro_f1_at_least_0_80": metric["macro_f1"] >= 0.80,
        "minimum_route_f1_at_least_0_70": metric["minimum_route_f1"] >= 0.70,
        "human_recall_at_least_0_95": metric["human_required_recall"] >= 0.95,
        "human_recall_ci_lower_at_least_0_90": metric["human_required_recall_ci95"]["lower"] >= 0.90,
        "zero_false_automation": metric["false_automation_count"] == 0,
        "false_automation_ci_upper_at_most_0_01": metric["false_automation_rate_ci95"]["upper"] <= 0.01
    }
    return {"eligible": all(checks.values()), "checks": checks, "group_count": group_count, "route_counts": dict(route_counts)}


def evaluate_shadow_traces(trace_path: Path, output_dir: Path, holdout_percent: int = 20) -> list[Path]:
    if not 1 <= holdout_percent <= 50:
        raise ValueError("holdout_percent must be between 1 and 50")
    traces = _read_traces(trace_path)
    holdout = [trace for trace in traces if _is_holdout(_group(trace), holdout_percent)]
    if not holdout:
        raise ValueError("deterministic holdout is empty; add more independent groups")
    definitions = (("Observed final route", "actual"), ("Shadow accepts every suggestion", "shadow_full"), ("Shadow accepts HUMAN_REQUIRED only", "safe_escalation"))
    metrics = [_evaluate(name, mode, holdout) for name, mode in definitions]
    candidate = next(item for item in metrics if item["mode"] == "safe_escalation")
    gate = _promotion_gate(candidate, holdout)
    digest = hashlib.sha256(trace_path.read_bytes()).hexdigest()
    payload = {
        "schema_version": "1.1",
        "created_at": datetime.now(UTC).isoformat(),
        "source": {"path": _portable_path(trace_path), "sha256": digest},
        "privacy": {"contains_prompt_text": False, "allowed_identifiers": "one-way SHA-256 hashes only"},
        "split": {
            "method": "SHA-256 group bucket; project_group_hash preferred, otherwise workspace_group_hash",
            "holdout_percent": holdout_percent,
            "total_samples": len(traces),
            "holdout_samples": len(holdout),
            "total_groups": len({_group(trace) for trace in traces}),
            "holdout_groups": len({_group(trace) for trace in holdout}),
            "holdout_trace_hashes": [trace.trace_hash for trace in holdout]
        },
        "traffic_prior": "post-stratified from all exported observation natural/risk frequencies",
        "weighting": {
            "method": "population stratum probability divided by reviewed holdout stratum count",
            "effective_sample_size": candidate["effective_sample_size"],
            "confidence_interval": "Kish effective sample size Wilson approximation"
        },
        "metrics": metrics,
        "promotion_candidate": "safe_escalation",
        "promotion_gate": gate
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "shadow_trace_evaluation.json"
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "shadow_trace_summary.csv"
    _write_csv(csv_path, metrics)
    dashboard_path = output_dir / "shadow_trace_dashboard.png"
    _plot_dashboard(dashboard_path, metrics, gate)
    table_path = output_dir / "shadow_trace_table.png"
    _plot_table(table_path, metrics)
    return [report_path, csv_path, dashboard_path, table_path]


def build_policy_replay_fixture(ab_report_path: Path, shift_report_path: Path, output_path: Path) -> Path:
    ab_report = _read_json(ab_report_path)
    shift_report = _read_json(shift_report_path)
    llm = next(router for router in ab_report["routers"] if router["name"] == "B_prompt_llm")
    llm_by_id = {str(item["case_id"]): item for item in llm["predictions"]}
    shadow_by_id = {str(item["id"]): item for item in shift_report["frozen_cases"]}
    traces: list[ShadowTrace] = []
    for index, case in enumerate(ab_report["cases"]):
        case_id = str(case["id"])
        prediction = llm_by_id[case_id]
        shadow = shadow_by_id[case_id]
        group = hashlib.sha256(f"fixture-group-{index // 2}".encode()).hexdigest()
        traces.append(ShadowTrace(
            trace_hash=hashlib.sha256(f"fixture-trace-{case_id}".encode()).hexdigest(),
            workspace_group_hash=group,
            project_group_hash=group,
            occurred_at=datetime(2026, 8, 27, tzinfo=UTC),
            final_route=str(prediction["route"]),
            shadow_suggested_route=str(shadow["predicted"]),
            shadow_needs_fallback=False,
            gold_route=str(case["expected_route"]),
            correction_source="POLICY_REPLAY",
            llm_called=True,
            routing_latency_ms=float(prediction["latency_ms"]),
            shadow_latency_ms=float(shift_report["method"]["latency_median_ms"]),
            routing_input_tokens=int(prediction.get("input_tokens", 0)),
            routing_output_tokens=int(prediction.get("output_tokens", 0)),
            routing_cost_usd=float(prediction["cost_usd"])
        ))
    strata = ["risk" if trace.final_route in {"REACT_AGENT", "HUMAN_REQUIRED"} or trace.shadow_suggested_route is not None and trace.shadow_suggested_route != trace.final_route else "natural" for trace in traces]
    counts = Counter(strata)
    weighted = [trace.model_copy(update={
        "schema_version": "1.1",
        "sampling_stratum": stratum,
        "population_stratum_probability": counts[stratum] / len(traces),
        "review_inclusion_probability": 1.0,
        "sample_weight": 1.0
    }) for trace, stratum in zip(traces, strata)]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(trace.model_dump_json() for trace in weighted) + "\n", encoding="utf-8")
    return output_path


def _write_csv(path: Path, metrics: list[dict[str, Any]]) -> None:
    fields = ["name", "sample_count", "effective_sample_size", "accuracy", "macro_f1", "minimum_route_f1", "human_required_recall", "false_automation_count", "false_automation_weighted_rate", "over_escalation_count", "over_escalation_weighted_rate", "llm_call_rate", "mean_routing_cost_usd", "estimated_cohort_routing_cost_usd", "mean_routing_latency_ms", "p95_routing_latency_ms"]
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(metrics)


def _plot_dashboard(path: Path, metrics: list[dict[str, Any]], gate: dict[str, Any]) -> None:
    names = [item["name"].replace("Shadow accepts ", "Shadow: ") for item in metrics]
    figure, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    status = "ELIGIBLE" if gate["eligible"] else "SHADOW ONLY"
    figure.suptitle(
        f"Privacy-safe Shadow Routing — Grouped Holdout\nPromotion gate: {status}",
        fontsize=17,
        fontweight="bold"
    )
    panels = (
        ("Macro-F1", [item["macro_f1"] for item in metrics], "#2563EB", (0, 1.05)),
        ("LLM call rate", [item["llm_call_rate"] for item in metrics], "#7C3AED", (0, 1.05)),
        ("Mean routing cost / request (USD)", [item["mean_routing_cost_usd"] for item in metrics], "#DC2626", None),
        ("Mean routing latency (ms)", [item["mean_routing_latency_ms"] for item in metrics], "#059669", None)
    )
    for axis, (title, values, color, limits) in zip(axes.flat, panels):
        bars = axis.bar(names, values, color=color)
        axis.bar_label(bars, fmt="%.3f", padding=3)
        if limits is not None:
            axis.set_ylim(*limits)
        axis.set_title(title, loc="left", fontweight="bold")
        axis.tick_params(axis="x", rotation=12)
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(axis="y", alpha=0.2)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, metrics: list[dict[str, Any]]) -> None:
    columns = ["Policy", "Raw N", "ESS", "Accuracy", "Macro-F1", "Human recall", "False auto", "LLM rate", "Mean cost / req", "Mean latency"]
    rows = [[item["name"], str(item["sample_count"]), f'{item["effective_sample_size"]:.1f}', f'{item["accuracy"]:.3f}', f'{item["macro_f1"]:.3f}', f'{item["human_required_recall"]:.3f}', str(item["false_automation_count"]), f'{item["llm_call_rate"]:.1%}', f'${item["mean_routing_cost_usd"]:.4f}', f'{item["mean_routing_latency_ms"]:.1f} ms'] for item in metrics]
    figure, axis = plt.subplots(figsize=(20, 4.5))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center", colWidths=[0.24, 0.05, 0.05, 0.08, 0.08, 0.10, 0.08, 0.08, 0.11, 0.10])
    table.auto_set_font_size(False)
    table.set_fontsize(10)
    table.scale(1, 1.9)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row in range(1, len(rows) + 1):
        for column in range(len(columns)):
            table[row, column].set_facecolor("#F0FDF4" if row % 2 else "#F9FAFB")
    figure.suptitle("Shadow Trace Evaluation — Traffic-weighted Results", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
