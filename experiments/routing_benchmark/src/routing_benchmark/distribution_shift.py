from __future__ import annotations

import csv
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score

from . import operational_replay as replay
from .metrics import routing_metrics

plt.switch_backend("Agg")


@dataclass(frozen=True)
class ShiftDiagnostics:
    predictions: dict[str, str]
    confidence: dict[str, float]
    similarity: dict[str, float]
    thresholds: dict[str, float]
    similarity_floors: dict[str, float]
    selected_c: float
    group_holdout_macro_f1: float
    validation_macro_f1: float
    frozen_macro_f1: float
    validation_ece: float
    frozen_ece: float
    latency_median_ms: float
    latency_p95_ms: float
    frozen_rows: list[dict[str, Any]]


def _expected_calibration_error(truth: list[str], predictions: list[str], confidence: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = len(truth)
    error = 0.0
    for lower, upper in pairwise(edges):
        members = [index for index, value in enumerate(confidence) if lower <= value < upper or upper == 1.0 and value == 1.0]
        if not members:
            continue
        accuracy = sum(truth[index] == predictions[index] for index in members) / len(members)
        mean_confidence = float(np.mean([confidence[index] for index in members]))
        error += len(members) / total * abs(accuracy - mean_confidence)
    return error


def _max_train_similarity(matrix: Any, train_matrix: Any) -> np.ndarray:
    similarities = matrix @ train_matrix.T
    return np.asarray(similarities.max(axis=1).toarray()).ravel() / 2.0


def _fit_shift_model(train_rows: list[dict[str, Any]], validation_rows: list[dict[str, Any]], frozen_rows: list[dict[str, Any]]) -> ShiftDiagnostics:
    selection_train = [row for row in train_rows if 1 <= int(row["generator_batch"]) <= 16]
    selection_holdout = [row for row in train_rows if 17 <= int(row["generator_batch"]) <= 20]
    selection_vectorizer = replay._features()
    selection_train_matrix = selection_vectorizer.fit_transform([str(row["prompt"]) for row in selection_train])
    selection_holdout_matrix = selection_vectorizer.transform([str(row["prompt"]) for row in selection_holdout])
    selection_train_labels = [str(row["expected_route"]) for row in selection_train]
    selection_holdout_labels = [str(row["expected_route"]) for row in selection_holdout]

    selected_c = 0.25
    group_holdout_macro_f1 = -1.0
    for c_value in (0.25, 0.5, 1.0, 2.0, 4.0):
        candidate = LogisticRegression(C=c_value, class_weight="balanced", max_iter=2_000, random_state=42)
        candidate.fit(selection_train_matrix, selection_train_labels)
        score = float(f1_score(selection_holdout_labels, candidate.predict(selection_holdout_matrix), average="macro"))
        if score > group_holdout_macro_f1:
            selected_c = c_value
            group_holdout_macro_f1 = score

    vectorizer = replay._features()
    train_text = [str(row["prompt"]) for row in train_rows]
    validation_text = [str(row["prompt"]) for row in validation_rows]
    frozen_text = [str(row["prompt"]) for row in frozen_rows]
    train_labels = [str(row["expected_route"]) for row in train_rows]
    validation_labels = [str(row["expected_route"]) for row in validation_rows]
    frozen_labels = [str(row["expected_route"]) for row in frozen_rows]
    train_matrix = vectorizer.fit_transform(train_text)
    validation_matrix = vectorizer.transform(validation_text)
    frozen_matrix = vectorizer.transform(frozen_text)
    model = LogisticRegression(C=selected_c, class_weight="balanced", max_iter=2_000, random_state=42)
    model.fit(train_matrix, train_labels)

    validation_probabilities = model.predict_proba(validation_matrix)
    frozen_probabilities = model.predict_proba(frozen_matrix)
    validation_indices = np.argmax(validation_probabilities, axis=1)
    frozen_indices = np.argmax(frozen_probabilities, axis=1)
    validation_predictions = [str(model.classes_[index]) for index in validation_indices]
    frozen_predictions = [str(model.classes_[index]) for index in frozen_indices]
    validation_confidence = np.max(validation_probabilities, axis=1)
    frozen_confidence = np.max(frozen_probabilities, axis=1)
    validation_similarity = _max_train_similarity(validation_matrix, train_matrix)
    frozen_similarity = _max_train_similarity(frozen_matrix, train_matrix)
    thresholds = replay._calibrate_thresholds(validation_labels, list(model.classes_), validation_probabilities)
    similarity_floors = {"p05": float(np.percentile(validation_similarity, 5)), "p10": float(np.percentile(validation_similarity, 10))}

    latency_ms: list[float] = []
    for _ in range(5):
        for text in frozen_text:
            started = time.perf_counter_ns()
            model.predict_proba(vectorizer.transform([text]))
            latency_ms.append((time.perf_counter_ns() - started) / 1_000_000)

    diagnostic_rows = [
        {
            "id": str(row["id"]),
            "expected": frozen_labels[index],
            "predicted": frozen_predictions[index],
            "confidence": float(frozen_confidence[index]),
            "nearest_train_similarity": float(frozen_similarity[index]),
            "correct": frozen_labels[index] == frozen_predictions[index]
        }
        for index, row in enumerate(frozen_rows)
    ]
    return ShiftDiagnostics(
        predictions={str(row["id"]): frozen_predictions[index] for index, row in enumerate(frozen_rows)},
        confidence={str(row["id"]): float(frozen_confidence[index]) for index, row in enumerate(frozen_rows)},
        similarity={str(row["id"]): float(frozen_similarity[index]) for index, row in enumerate(frozen_rows)},
        thresholds=thresholds,
        similarity_floors=similarity_floors,
        selected_c=selected_c,
        group_holdout_macro_f1=group_holdout_macro_f1,
        validation_macro_f1=float(f1_score(validation_labels, validation_predictions, average="macro")),
        frozen_macro_f1=float(f1_score(frozen_labels, frozen_predictions, average="macro")),
        validation_ece=_expected_calibration_error(validation_labels, validation_predictions, validation_confidence),
        frozen_ece=_expected_calibration_error(frozen_labels, frozen_predictions, frozen_confidence),
        latency_median_ms=float(np.median(latency_ms)),
        latency_p95_ms=float(np.percentile(latency_ms, 95)),
        frozen_rows=diagnostic_rows
    )


def _accept_local(mode: str, case_id: str, diagnostics: ShiftDiagnostics) -> bool:
    route = diagnostics.predictions[case_id]
    if mode == "safe_escalation":
        return route == "HUMAN_REQUIRED"
    threshold = diagnostics.thresholds.get(route)
    if threshold is None or diagnostics.confidence[case_id] < threshold:
        return False
    if mode == "confidence":
        return True
    floor_name = "p05" if mode == "ood_p05" else "p10"
    return diagnostics.similarity[case_id] >= diagnostics.similarity_floors[floor_name]


def _evaluate_cascade(name: str, mode: str, cases: list[dict[str, Any]], llm_predictions: dict[str, dict[str, Any]], diagnostics: ShiftDiagnostics) -> dict[str, Any]:
    truth: list[str] = []
    predictions: list[str] = []
    llm_calls = 0
    llm_cost = 0.0
    latencies: list[float] = []
    sources = {"TRUSTED_POLICY": 0, "LOCAL_MODEL": 0, "LLM": 0}
    for case in cases:
        case_id = str(case["id"])
        expected = str(case["expected_route"])
        selected = replay._trusted_contract_route(case) if mode != "llm_all" else None
        source = "TRUSTED_POLICY" if selected else ""
        if selected is None and mode not in {"llm_all", "policy_only"} and _accept_local(mode, case_id, diagnostics):
            selected = diagnostics.predictions[case_id]
            source = "LOCAL_MODEL"
        if selected is None:
            item = llm_predictions[case_id]
            selected = str(item["route"])
            source = "LLM"
            llm_calls += 1
            llm_cost += float(item["cost_usd"])
            latencies.append(float(item["latency_ms"]))
        elif source == "LOCAL_MODEL":
            latencies.append(diagnostics.latency_median_ms)
        else:
            latencies.append(replay.POLICY_LATENCY_MS)
        truth.append(expected)
        predictions.append(selected)
        sources[source] += 1

    metrics = routing_metrics(truth, predictions, replay.ROUTES)
    route_f1 = {route: float(metrics["per_route"][route]["f1-score"]) for route in replay.ROUTES}
    human_recall = float(metrics["per_route"]["HUMAN_REQUIRED"]["recall"])
    false_automation = sum(expected == "HUMAN_REQUIRED" and predicted != "HUMAN_REQUIRED" for expected, predicted in zip(truth, predictions))
    return {
        "name": name,
        "mode": mode,
        "accuracy": float(metrics["accuracy"]),
        "macro_f1": float(metrics["macro_f1"]),
        "minimum_route_f1": min(route_f1.values()),
        "human_required_recall": human_recall,
        "false_automation_count": false_automation,
        "over_escalation_count": sum(expected != "HUMAN_REQUIRED" and predicted == "HUMAN_REQUIRED" for expected, predicted in zip(truth, predictions)),
        "llm_calls": llm_calls,
        "llm_call_rate": llm_calls / len(cases),
        "llm_cost_usd": llm_cost,
        "mean_estimated_latency_ms": float(np.mean(latencies)),
        "p95_estimated_latency_ms": float(np.percentile(latencies, 95)),
        "decision_counts": sources,
        "passes_local_promotion_gate": min(route_f1.values()) >= 0.70 and human_recall >= 0.95 and false_automation == 0
    }


def _risk_coverage(rows: list[dict[str, Any]]) -> list[dict[str, float]]:
    points: list[dict[str, float]] = []
    for threshold in np.linspace(0.0, 1.0, 101):
        accepted = [row for row in rows if float(row["confidence"]) >= threshold]
        if not accepted:
            continue
        accuracy = sum(bool(row["correct"]) for row in accepted) / len(accepted)
        false_automation = sum(row["expected"] == "HUMAN_REQUIRED" and row["predicted"] != "HUMAN_REQUIRED" for row in accepted)
        points.append({"threshold": float(threshold), "coverage": len(accepted) / len(rows), "selective_accuracy": accuracy, "false_automation_count": float(false_automation)})
    return points


def evaluate_distribution_shift(ab_report_path: Path, train_path: Path, validation_path: Path, output_dir: Path) -> list[Path]:
    ab_report = replay._read_json(ab_report_path)
    cases = list(ab_report["cases"])
    llm_router = next(router for router in ab_report["routers"] if router["name"] == "B_prompt_llm")
    llm_predictions = {str(item["case_id"]): item for item in llm_router["predictions"]}
    diagnostics = _fit_shift_model(replay._read_jsonl(train_path), replay._read_jsonl(validation_path), cases)
    definitions = (
        ("LLM for every request", "llm_all"),
        ("Trusted contract → LLM", "policy_only"),
        ("Policy → safe escalation → LLM", "safe_escalation"),
        ("Policy → confidence gate → LLM", "confidence"),
        ("Policy → OOD p05 gate → LLM", "ood_p05"),
        ("Policy → OOD p10 gate → LLM", "ood_p10")
    )
    cascades = [_evaluate_cascade(name, mode, cases, llm_predictions, diagnostics) for name, mode in definitions]
    baseline_cost = float(cascades[0]["llm_cost_usd"])
    for cascade in cascades:
        cascade["llm_cost_savings_rate"] = 1.0 - float(cascade["llm_cost_usd"]) / baseline_cost if baseline_cost else 0.0

    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "distribution_shift_evaluation.json"
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "sources": {"ab_report": replay._portable_path(ab_report_path), "train": replay._portable_path(train_path), "validation": replay._portable_path(validation_path)},
        "method": {
            "model_selection_train_batches": "1-16",
            "model_selection_holdout_batches": "17-20",
            "partial_batch_21_excluded_from_model_selection": True,
            "threshold_source": "independent synthetic validation only",
            "frozen_test_used_for_selection": False,
            "selected_c": diagnostics.selected_c,
            "thresholds": diagnostics.thresholds,
            "similarity_floors": diagnostics.similarity_floors,
            "latency_median_ms": diagnostics.latency_median_ms,
            "latency_p95_ms": diagnostics.latency_p95_ms
        },
        "distribution_metrics": {
            "group_holdout_macro_f1": diagnostics.group_holdout_macro_f1,
            "validation_macro_f1": diagnostics.validation_macro_f1,
            "frozen_macro_f1": diagnostics.frozen_macro_f1,
            "validation_ece": diagnostics.validation_ece,
            "frozen_ece": diagnostics.frozen_ece,
            "macro_f1_transfer_gap": diagnostics.validation_macro_f1 - diagnostics.frozen_macro_f1
        },
        "cascades": cascades,
        "risk_coverage": _risk_coverage(diagnostics.frozen_rows),
        "frozen_cases": diagnostics.frozen_rows
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "distribution_shift_summary.csv"
    _write_csv(csv_path, cascades)
    dashboard_path = output_dir / "distribution_shift_dashboard.png"
    _plot_dashboard(dashboard_path, payload)
    table_path = output_dir / "distribution_shift_table.png"
    _plot_table(table_path, cascades)
    return [report_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, cascades: list[dict[str, Any]]) -> None:
    fields = ["name", "accuracy", "macro_f1", "minimum_route_f1", "human_required_recall", "false_automation_count", "over_escalation_count", "llm_call_rate", "llm_cost_usd", "llm_cost_savings_rate", "mean_estimated_latency_ms", "p95_estimated_latency_ms", "passes_local_promotion_gate"]
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(cascades)


def _plot_dashboard(path: Path, report: dict[str, Any]) -> None:
    metrics = report["distribution_metrics"]
    rows = report["frozen_cases"]
    risk = report["risk_coverage"]
    figure, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    figure.suptitle("Local Router Distribution Shift — Synthetic to Frozen", fontsize=17, fontweight="bold")

    names = ["Group holdout", "Synthetic validation", "Frozen test"]
    values = [metrics["group_holdout_macro_f1"], metrics["validation_macro_f1"], metrics["frozen_macro_f1"]]
    bars = axes[0, 0].bar(names, values, color=["#2563EB", "#059669", "#DC2626"])
    axes[0, 0].bar_label(bars, fmt="%.3f", padding=3)
    axes[0, 0].set_ylim(0, 1.05)
    _style(axes[0, 0], "Macro-F1 transfer", "Macro-F1")

    correct_confidence = [row["confidence"] for row in rows if row["correct"]]
    wrong_confidence = [row["confidence"] for row in rows if not row["correct"]]
    axes[0, 1].hist(correct_confidence, bins=10, alpha=0.65, label="Correct", color="#059669")
    axes[0, 1].hist(wrong_confidence, bins=10, alpha=0.65, label="Wrong", color="#DC2626")
    axes[0, 1].legend(frameon=False)
    _style(axes[0, 1], "Frozen confidence overlap", "Cases")

    correct_similarity = [row["nearest_train_similarity"] for row in rows if row["correct"]]
    wrong_similarity = [row["nearest_train_similarity"] for row in rows if not row["correct"]]
    axes[1, 0].hist(correct_similarity, bins=10, alpha=0.65, label="Correct", color="#2563EB")
    axes[1, 0].hist(wrong_similarity, bins=10, alpha=0.65, label="Wrong", color="#F97316")
    for name, floor in report["method"]["similarity_floors"].items():
        axes[1, 0].axvline(floor, linestyle="--", label=name)
    axes[1, 0].legend(frameon=False)
    _style(axes[1, 0], "Nearest-train similarity", "Cases")

    axes[1, 1].plot([point["coverage"] for point in risk], [point["selective_accuracy"] for point in risk], color="#7C3AED", linewidth=2)
    axes[1, 1].set_xlim(0, 1.02)
    axes[1, 1].set_ylim(0, 1.02)
    axes[1, 1].set_xlabel("Coverage")
    _style(axes[1, 1], "Frozen confidence risk–coverage", "Selective accuracy")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, cascades: list[dict[str, Any]]) -> None:
    columns = ["Policy", "Accuracy", "Macro-F1", "Human recall", "False auto", "LLM rate", "Cost saved"]
    rows = [[item["name"], f'{item["accuracy"]:.3f}', f'{item["macro_f1"]:.3f}', f'{item["human_required_recall"]:.3f}', str(item["false_automation_count"]), f'{item["llm_call_rate"]:.0%}', f'{item["llm_cost_savings_rate"]:.1%}'] for item in cascades]
    figure, axis = plt.subplots(figsize=(17, 5.2))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center", colWidths=[0.34, 0.10, 0.10, 0.12, 0.10, 0.10, 0.11])
    table.auto_set_font_size(False)
    table.set_fontsize(10)
    table.scale(1, 1.8)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row in range(1, len(rows) + 1):
        color = "#F0FDF4" if row % 2 else "#F9FAFB"
        for column in range(len(columns)):
            table[row, column].set_facecolor(color)
    figure.suptitle("OOD-aware Selective Routing — Summary Table", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _style(axis: Any, title: str, ylabel: str) -> None:
    axis.set_title(title, loc="left", fontweight="bold")
    axis.set_ylabel(ylabel)
    axis.spines[["top", "right"]].set_visible(False)
    axis.grid(axis="y", alpha=0.2)
    axis.set_axisbelow(True)
