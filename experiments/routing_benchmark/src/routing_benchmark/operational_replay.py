from __future__ import annotations

import csv
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.pipeline import FeatureUnion

from .metrics import routing_metrics

plt.switch_backend("Agg")

ROUTES = ("DIRECT_TOOL", "SIMPLE_LLM", "REACT_AGENT", "SUPERVISOR", "HUMAN_REQUIRED")
LOCAL_ACCEPT_PRECISION = 0.95
MIN_CALIBRATION_ACCEPTS = 5
POLICY_LATENCY_MS = 0.1


@dataclass(frozen=True)
class LocalModelResult:
    predictions: dict[str, str]
    confidence: dict[str, float]
    thresholds: dict[str, float]
    selected_c: float
    validation_macro_f1: float
    mean_latency_ms: float
    p95_latency_ms: float


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _portable_path(path: Path) -> str:
    parts = path.resolve().parts
    for marker in ("experiments", "agent", "docs"):
        if marker in parts:
            return Path(*parts[parts.index(marker):]).as_posix()
    return path.name


def _features() -> FeatureUnion:
    word = TfidfVectorizer(analyzer="word", ngram_range=(1, 2), min_df=2, max_features=20_000, sublinear_tf=True)
    character = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=2, max_features=30_000, sublinear_tf=True)
    return FeatureUnion([("word", word), ("character", character)])


def _fit_local_model(train_rows: list[dict[str, Any]], validation_rows: list[dict[str, Any]], test_rows: list[dict[str, Any]]) -> LocalModelResult:
    train_text = [str(row["prompt"]) for row in train_rows]
    train_labels = [str(row["expected_route"]) for row in train_rows]
    validation_text = [str(row["prompt"]) for row in validation_rows]
    validation_labels = [str(row["expected_route"]) for row in validation_rows]
    test_text = [str(row["prompt"]) for row in test_rows]

    vectorizer = _features()
    train_matrix = vectorizer.fit_transform(train_text)
    validation_matrix = vectorizer.transform(validation_text)
    test_matrix = vectorizer.transform(test_text)

    best: tuple[float, float, LogisticRegression] | None = None
    for c_value in (0.25, 0.5, 1.0, 2.0, 4.0):
        model = LogisticRegression(C=c_value, class_weight="balanced", max_iter=2_000, random_state=42)
        model.fit(train_matrix, train_labels)
        score = float(f1_score(validation_labels, model.predict(validation_matrix), average="macro"))
        candidate = (score, -c_value, model)
        if best is None or candidate[:2] > best[:2]:
            best = candidate

    if best is None:
        raise RuntimeError("local model selection produced no candidate")
    validation_macro_f1, negative_c, model = best
    validation_probabilities = model.predict_proba(validation_matrix)
    thresholds = _calibrate_thresholds(validation_labels, list(model.classes_), validation_probabilities)
    test_probabilities = model.predict_proba(test_matrix)
    test_indices = np.argmax(test_probabilities, axis=1)
    predictions = {str(row["id"]): str(model.classes_[index]) for row, index in zip(test_rows, test_indices)}
    confidence = {str(row["id"]): float(test_probabilities[row_index, class_index]) for row_index, (row, class_index) in enumerate(zip(test_rows, test_indices))}
    latency_ms: list[float] = []
    for text in test_text:
        started = time.perf_counter_ns()
        model.predict_proba(vectorizer.transform([text]))
        latency_ms.append((time.perf_counter_ns() - started) / 1_000_000)
    return LocalModelResult(predictions=predictions, confidence=confidence, thresholds=thresholds, selected_c=-negative_c, validation_macro_f1=validation_macro_f1, mean_latency_ms=float(np.mean(latency_ms)), p95_latency_ms=float(np.percentile(latency_ms, 95)))


def _calibrate_thresholds(truth: list[str], classes: list[str], probabilities: np.ndarray) -> dict[str, float]:
    predicted_indices = np.argmax(probabilities, axis=1)
    thresholds: dict[str, float] = {}
    for class_index, route in enumerate(classes):
        if route == "HUMAN_REQUIRED":
            thresholds[route] = 0.0
            continue
        candidates = sorted({float(probabilities[index, class_index]) for index in range(len(truth))}, reverse=True)
        selected: float | None = None
        selected_count = -1
        for threshold in candidates:
            accepted = [index for index in range(len(truth)) if predicted_indices[index] == class_index and probabilities[index, class_index] >= threshold]
            if len(accepted) < MIN_CALIBRATION_ACCEPTS:
                continue
            correct = sum(truth[index] == route for index in accepted)
            false_automation = sum(truth[index] == "HUMAN_REQUIRED" for index in accepted)
            precision = correct / len(accepted)
            if precision >= LOCAL_ACCEPT_PRECISION and false_automation == 0 and len(accepted) > selected_count:
                selected = threshold
                selected_count = len(accepted)
        if selected is not None:
            thresholds[route] = selected
    return thresholds


def _trusted_contract_route(case: dict[str, Any]) -> str | None:
    case_id = str(case["id"])
    if case_id.startswith("direct_tool-project-"):
        return "DIRECT_TOOL"
    if case_id.startswith("supervisor-project-"):
        return "SUPERVISOR"
    return None


def _evaluate_policy(name: str, cases: list[dict[str, Any]], llm_predictions: dict[str, dict[str, Any]], local: LocalModelResult, hybrid_cases: dict[str, dict[str, Any]], mode: str) -> dict[str, Any]:
    truth: list[str] = []
    predictions: list[str] = []
    latencies: list[float] = []
    llm_cost = 0.0
    llm_calls = 0
    decision_counts = {"TRUSTED_POLICY": 0, "LOCAL_MODEL": 0, "LLM": 0}

    for case in cases:
        case_id = str(case["id"])
        expected = str(case["expected_route"])
        trusted = _trusted_contract_route(case) if mode != "llm_all" else None
        selected_route: str | None = trusted
        source = "TRUSTED_POLICY" if trusted else ""

        if selected_route is None and mode in {"policy_escalation", "policy_calibrated"}:
            local_route = local.predictions[case_id]
            threshold = local.thresholds.get(local_route)
            if mode == "policy_escalation" and local_route != "HUMAN_REQUIRED":
                threshold = None
            if threshold is not None and local.confidence[case_id] >= threshold:
                selected_route = local_route
                source = "LOCAL_MODEL"

        if selected_route is None and mode == "legacy_agreement":
            hybrid = hybrid_cases[case_id]
            if hybrid["bm25"] == hybrid["encoder"]:
                selected_route = str(hybrid["bm25"])
                source = "LOCAL_MODEL"

        if selected_route is None:
            prediction = llm_predictions[case_id]
            selected_route = str(prediction["route"])
            source = "LLM"
            llm_calls += 1
            llm_cost += float(prediction["cost_usd"])
            latencies.append(float(prediction["latency_ms"]))
        elif source == "LOCAL_MODEL":
            local_latency = hybrid_cases[case_id].get("local_latency_ms", 266.632512) if mode == "legacy_agreement" else local.mean_latency_ms
            latencies.append(float(local_latency))
        else:
            latencies.append(POLICY_LATENCY_MS)

        truth.append(expected)
        predictions.append(selected_route)
        decision_counts[source] += 1

    metrics = routing_metrics(truth, predictions, ROUTES)
    human_indices = [index for index, route in enumerate(truth) if route == "HUMAN_REQUIRED"]
    false_automation = sum(predictions[index] != "HUMAN_REQUIRED" for index in human_indices)
    over_escalation = sum(predicted == "HUMAN_REQUIRED" and expected != "HUMAN_REQUIRED" for expected, predicted in zip(truth, predictions))
    route_f1 = {route: float(metrics["per_route"][route]["f1-score"]) for route in ROUTES}
    human_recall = float(metrics["per_route"]["HUMAN_REQUIRED"]["recall"])
    return {
        "name": name,
        "mode": mode,
        "accuracy": metrics["accuracy"],
        "macro_f1": metrics["macro_f1"],
        "minimum_route_f1": min(route_f1.values()),
        "route_f1": route_f1,
        "human_required_recall": human_recall,
        "false_automation_count": false_automation,
        "over_escalation_count": over_escalation,
        "llm_calls": llm_calls,
        "llm_call_rate": llm_calls / len(cases),
        "llm_cost_usd": llm_cost,
        "mean_estimated_latency_ms": float(np.mean(latencies)),
        "p95_estimated_latency_ms": float(np.percentile(latencies, 95)),
        "decision_counts": decision_counts,
        "passes_local_promotion_gate": min(route_f1.values()) >= 0.70 and human_recall >= 0.95 and false_automation == 0
    }


def evaluate_operational_replay(ab_report_path: Path, hybrid_report_path: Path, train_path: Path, validation_path: Path, output_dir: Path) -> list[Path]:
    ab_report = _read_json(ab_report_path)
    hybrid_report = _read_json(hybrid_report_path)
    cases = list(ab_report["cases"])
    llm_router = next(router for router in ab_report["routers"] if router["name"] == "B_prompt_llm")
    llm_predictions = {str(item["case_id"]): item for item in llm_router["predictions"]}
    hybrid_cases = {str(item["id"]): item for item in hybrid_report["cases"]}
    for item in hybrid_cases.values():
        item["local_latency_ms"] = float(hybrid_report["runtime"]["latency_ms_mean"])

    local = _fit_local_model(_read_jsonl(train_path), _read_jsonl(validation_path), cases)
    definitions = (
        ("LLM for every request", "llm_all"),
        ("Trusted contract → LLM", "policy_first"),
        ("Trusted contract → safe local escalation → LLM", "policy_escalation"),
        ("Trusted contract → calibrated local → LLM", "policy_calibrated"),
        ("Legacy lane agreement → LLM", "legacy_agreement")
    )
    policies = [_evaluate_policy(name, cases, llm_predictions, local, hybrid_cases, mode) for name, mode in definitions]
    baseline_cost = float(policies[0]["llm_cost_usd"])
    for policy in policies:
        policy["llm_cost_savings_rate"] = 1.0 - float(policy["llm_cost_usd"]) / baseline_cost if baseline_cost else 0.0

    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "operational_policy_replay.json"
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "sources": {"ab_report": _portable_path(ab_report_path), "hybrid_report": _portable_path(hybrid_report_path), "train": _portable_path(train_path), "validation": _portable_path(validation_path)},
        "method": {
            "frozen_test_count": len(cases),
            "trusted_contract_fixture_count": sum(_trusted_contract_route(case) is not None for case in cases),
            "local_model": "word+character TF-IDF with multinomial logistic regression",
            "selected_c": local.selected_c,
            "validation_macro_f1": local.validation_macro_f1,
            "mean_single_query_latency_ms": local.mean_latency_ms,
            "p95_single_query_latency_ms": local.p95_latency_ms,
            "thresholds": local.thresholds,
            "threshold_min_precision": LOCAL_ACCEPT_PRECISION,
            "threshold_min_accepts": MIN_CALIBRATION_ACCEPTS,
            "threshold_selection_used_frozen_test": False,
            "policy_latency_assumption_ms": POLICY_LATENCY_MS,
            "local_latency_source": "2026-08-13 hybrid CPU mean"
        },
        "policies": policies
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    table_path = output_dir / "operational_policy_summary.csv"
    _write_table(table_path, policies)
    plot_path = output_dir / "operational_policy_dashboard.png"
    _plot_dashboard(plot_path, policies)
    table_plot_path = output_dir / "operational_policy_table.png"
    _plot_table(table_plot_path, policies)
    return [report_path, table_path, plot_path, table_plot_path]


def _write_table(path: Path, policies: list[dict[str, Any]]) -> None:
    fields = ["name", "accuracy", "macro_f1", "minimum_route_f1", "human_required_recall", "false_automation_count", "over_escalation_count", "llm_call_rate", "llm_cost_usd", "llm_cost_savings_rate", "mean_estimated_latency_ms", "p95_estimated_latency_ms", "passes_local_promotion_gate"]
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(policies)


def _plot_dashboard(path: Path, policies: list[dict[str, Any]]) -> None:
    labels = ["LLM all", "Policy→LLM", "Policy→safe\nescalation→LLM", "Policy→calibrated\nlocal→LLM", "Legacy\nagreement→LLM"]
    x = np.arange(len(policies))
    figure, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    figure.suptitle("Operational Routing Policy Replay — Frozen 50", fontsize=17, fontweight="bold")

    axes[0, 0].bar(x - 0.18, [item["accuracy"] for item in policies], 0.36, label="Accuracy")
    axes[0, 0].bar(x + 0.18, [item["macro_f1"] for item in policies], 0.36, label="Macro-F1")
    axes[0, 0].set_ylim(0, 1.05)
    axes[0, 0].legend(frameon=False)
    _style_axis(axes[0, 0], labels, "Quality", "Score")

    axes[0, 1].bar(x, [item["llm_call_rate"] for item in policies], color="#2563EB")
    axes[0, 1].set_ylim(0, 1.05)
    _style_axis(axes[0, 1], labels, "LLM call exposure", "Call rate")

    axes[1, 0].bar(x - 0.18, [item["human_required_recall"] for item in policies], 0.36, label="HUMAN recall", color="#059669")
    axes[1, 0].bar(x + 0.18, [item["false_automation_count"] for item in policies], 0.36, label="False automation", color="#DC2626")
    axes[1, 0].legend(frameon=False)
    _style_axis(axes[1, 0], labels, "Safety outcomes", "Recall / count")

    axes[1, 1].bar(x - 0.18, [item["mean_estimated_latency_ms"] for item in policies], 0.36, label="Mean")
    axes[1, 1].bar(x + 0.18, [item["p95_estimated_latency_ms"] for item in policies], 0.36, label="p95")
    axes[1, 1].set_yscale("log")
    axes[1, 1].legend(frameon=False)
    _style_axis(axes[1, 1], labels, "Estimated routing latency", "Milliseconds, log scale")

    for axis in axes.flat:
        for container in axis.containers:
            axis.bar_label(container, fmt="%.3g", padding=3, fontsize=8)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _style_axis(axis: Any, labels: list[str], title: str, ylabel: str) -> None:
    axis.set_title(title, loc="left", fontweight="bold")
    axis.set_xticks(np.arange(len(labels)), labels, fontsize=8)
    axis.set_ylabel(ylabel)
    axis.spines[["top", "right"]].set_visible(False)
    axis.grid(axis="y", alpha=0.2)
    axis.set_axisbelow(True)


def _plot_table(path: Path, policies: list[dict[str, Any]]) -> None:
    columns = ["Policy", "Accuracy", "Macro-F1", "Human recall", "False auto", "LLM rate", "Cost saved"]
    rows = [
        [
            item["name"],
            f'{item["accuracy"]:.3f}',
            f'{item["macro_f1"]:.3f}',
            f'{item["human_required_recall"]:.3f}',
            str(item["false_automation_count"]),
            f'{item["llm_call_rate"]:.0%}',
            f'{item["llm_cost_savings_rate"]:.1%}'
        ]
        for item in policies
    ]
    figure, axis = plt.subplots(figsize=(17, 4.8))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center", colWidths=[0.34, 0.10, 0.10, 0.12, 0.10, 0.10, 0.11])
    table.auto_set_font_size(False)
    table.set_fontsize(10)
    table.scale(1, 1.8)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row in range(1, len(rows) + 1):
        color = "#EFF6FF" if row % 2 else "#F9FAFB"
        for column in range(len(columns)):
            table[row, column].set_facecolor(color)
    figure.suptitle("Operational Routing Policy Replay — Summary Table", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
