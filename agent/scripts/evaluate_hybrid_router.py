"""Evaluate BM25, LiquidAI A1, and hybrid RRF on the frozen route test set."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import time
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import torch

from graph.router import build_local_route_model
from routing.hybrid import ROUTE_ORDER

plt.switch_backend("Agg")
LABELS = [route.value for route in ROUTE_ORDER]


def _confusion(truth: Sequence[str], predicted: Sequence[str]) -> list[list[int]]:
    positions = {label: index for index, label in enumerate(LABELS)}
    matrix = [[0 for _ in LABELS] for _ in LABELS]
    for expected, actual in zip(truth, predicted, strict=True):
        matrix[positions[expected]][positions[actual]] += 1
    return matrix


def _metrics(truth: Sequence[str], predicted: Sequence[str]) -> dict[str, Any]:
    matrix = _confusion(truth, predicted)
    per_route: dict[str, dict[str, float | int]] = {}
    f1_values: list[float] = []
    for index, label in enumerate(LABELS):
        true_positive = matrix[index][index]
        false_positive = sum(row[index] for row in matrix) - true_positive
        false_negative = sum(matrix[index]) - true_positive
        precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
        recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        f1_values.append(f1)
        per_route[label] = {
            "support": sum(matrix[index]),
            "precision": precision,
            "recall": recall,
            "f1": f1,
        }
    return {
        "accuracy": sum(expected == actual for expected, actual in zip(truth, predicted, strict=True)) / len(truth),
        "macro_f1": sum(f1_values) / len(f1_values),
        "per_route": per_route,
        "confusion_matrix": matrix,
    }


def _cohen_kappa(first: Sequence[str], second: Sequence[str]) -> float:
    sample_count = len(first)
    observed = sum(left == right for left, right in zip(first, second, strict=True)) / sample_count
    first_counts = Counter(first)
    second_counts = Counter(second)
    expected = sum(first_counts[label] * second_counts[label] for label in LABELS) / sample_count**2
    return (observed - expected) / (1 - expected) if expected < 1 else 1.0


def _cramers_v(first: Sequence[str], second: Sequence[str]) -> float:
    positions = {label: index for index, label in enumerate(LABELS)}
    table = np.zeros((len(LABELS), len(LABELS)), dtype=float)
    for left, right in zip(first, second, strict=True):
        table[positions[left], positions[right]] += 1
    expected = np.outer(table.sum(axis=1), table.sum(axis=0)) / table.sum()
    valid = expected > 0
    chi_square = float((((table - expected) ** 2)[valid] / expected[valid]).sum())
    return math.sqrt(chi_square / (table.sum() * (len(LABELS) - 1)))


def _correlation(values: Sequence[float], correct: Sequence[bool]) -> float | None:
    left = np.asarray(values, dtype=float)
    right = np.asarray(correct, dtype=float)
    if np.std(left) == 0 or np.std(right) == 0:
        return None
    return float(np.corrcoef(left, right)[0, 1])


def _exact_mcnemar(truth: Sequence[str], first: Sequence[str], second: Sequence[str]) -> dict[str, float | int]:
    first_only = sum(
        left == expected and right != expected
        for expected, left, right in zip(truth, first, second, strict=True)
    )
    second_only = sum(
        right == expected and left != expected
        for expected, left, right in zip(truth, first, second, strict=True)
    )
    discordant = first_only + second_only
    if discordant == 0:
        p_value = 1.0
    else:
        tail = sum(math.comb(discordant, index) for index in range(min(first_only, second_only) + 1))
        p_value = min(1.0, 2 * tail / 2**discordant)
    return {"first_only_correct": first_only, "second_only_correct": second_only, "p_value": p_value}


def _plot_confusions(report: dict[str, Any], output: Path) -> None:
    figure, axes = plt.subplots(1, 3, figsize=(18, 5.8), constrained_layout=True)
    for axis, name in zip(axes, ("bm25", "encoder", "rrf"), strict=True):
        matrix = np.asarray(report["models"][name]["confusion_matrix"])
        image = axis.imshow(matrix, cmap="Blues", vmin=0, vmax=max(10, int(matrix.max())))
        axis.set_title(f"{name.upper()} confusion")
        axis.set_xticks(range(len(LABELS)), LABELS, rotation=45, ha="right", fontsize=8)
        axis.set_yticks(range(len(LABELS)), LABELS, fontsize=8)
        axis.set_xlabel("Predicted")
        axis.set_ylabel("Expected")
        for row in range(len(LABELS)):
            for column in range(len(LABELS)):
                axis.text(column, row, str(matrix[row, column]), ha="center", va="center", fontsize=9)
        figure.colorbar(image, ax=axis, fraction=0.046)
    figure.savefig(output, dpi=180)
    plt.close(figure)


def _plot_dashboard(report: dict[str, Any], output: Path) -> None:
    figure, axes = plt.subplots(2, 2, figsize=(14, 10), constrained_layout=True)
    names = ["bm25", "encoder", "rrf"]
    x = np.arange(len(names))
    axes[0, 0].bar(x - 0.17, [report["models"][name]["accuracy"] for name in names], 0.34, label="accuracy")
    axes[0, 0].bar(x + 0.17, [report["models"][name]["macro_f1"] for name in names], 0.34, label="macro-F1")
    axes[0, 0].set_xticks(x, [name.upper() for name in names])
    axes[0, 0].set_ylim(0, 1)
    axes[0, 0].set_title("Standalone model quality")
    axes[0, 0].legend()

    rrf_routes = report["models"]["rrf"]["per_route"]
    route_x = np.arange(len(LABELS))
    axes[0, 1].bar(route_x, [rrf_routes[label]["f1"] for label in LABELS])
    axes[0, 1].set_xticks(route_x, LABELS, rotation=35, ha="right", fontsize=8)
    axes[0, 1].set_ylim(0, 1)
    axes[0, 1].set_title("RRF F1 by route")

    margins = np.asarray([row["margin"] for row in report["cases"]])
    correct = np.asarray([row["rrf_correct"] for row in report["cases"]])
    axes[1, 0].scatter(np.arange(len(margins))[correct], margins[correct], label="correct", alpha=0.75)
    axes[1, 0].scatter(np.arange(len(margins))[~correct], margins[~correct], label="wrong", alpha=0.75)
    axes[1, 0].set_title("RRF margin and correctness")
    axes[1, 0].set_xlabel("Frozen case index")
    axes[1, 0].set_ylabel("Normalized margin")
    axes[1, 0].legend()

    fallback_counts = Counter(
        row["fallback_reason"] or "ACCEPTED" for row in report["cases"]
    )
    fallback_names = list(fallback_counts)
    axes[1, 1].bar(range(len(fallback_names)), [fallback_counts[name] for name in fallback_names])
    axes[1, 1].set_xticks(range(len(fallback_names)), fallback_names, rotation=30, ha="right", fontsize=8)
    axes[1, 1].set_title("Local gate outcomes")
    figure.savefig(output, dpi=180)
    plt.close(figure)


async def evaluate(dataset_path: Path, train_path: Path) -> dict[str, Any]:
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    cases = dataset["cases"]
    train_prompts = {
        json.loads(line)["prompt"].strip()
        for line in train_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }
    model_started = time.perf_counter()
    model = await asyncio.to_thread(build_local_route_model)
    load_seconds = time.perf_counter() - model_started

    rows: list[dict[str, Any]] = []
    latencies: list[float] = []
    for case in cases:
        started = time.perf_counter()
        decision = await model.route(case["prompt"])
        latencies.append((time.perf_counter() - started) * 1_000)
        bm25 = decision.bm25_ranking[0].route.value
        encoder = decision.encoder_ranking[0].route.value
        rrf = decision.fused_ranking[0].route.value
        rows.append(
            {
                "id": case["id"],
                "expected": case["expected_route"],
                "bm25": bm25,
                "encoder": encoder,
                "rrf": rrf,
                "rrf_correct": rrf == case["expected_route"],
                "accepted_route": decision.route.value if decision.route is not None else None,
                "fallback_reason": decision.fallback_reason,
                "fused_share": decision.fused_share,
                "margin": decision.margin,
            }
        )

    truth = [row["expected"] for row in rows]
    bm25 = [row["bm25"] for row in rows]
    encoder = [row["encoder"] for row in rows]
    rrf = [row["rrf"] for row in rows]
    accepted = [row for row in rows if row["accepted_route"] is not None]
    rrf_correct = [bool(row["rrf_correct"]) for row in rows]
    accepted_by_expected: dict[str, dict[str, float | int | None]] = {}
    for label in LABELS:
        selected = [row for row in accepted if row["expected"] == label]
        correct_count = sum(row["accepted_route"] == row["expected"] for row in selected)
        accepted_by_expected[label] = {
            "accepted_count": len(selected),
            "correct_count": correct_count,
            "accuracy": correct_count / len(selected) if selected else None,
        }
    return {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "dataset": {
            "source_file": dataset_path.name,
            "sha256": hashlib.sha256(dataset_path.read_bytes()).hexdigest(),
            "sample_count": len(rows),
            "route_counts": dict(Counter(truth)),
            "exact_train_prompt_overlap_count": sum(case["prompt"].strip() in train_prompts for case in cases),
        },
        "runtime": {
            "encoder_model_id": model.encoder_model_id,
            "torch_version": torch.__version__,
            "cuda_available": torch.cuda.is_available(),
            "model_load_seconds": load_seconds,
            "latency_ms_mean": float(np.mean(latencies)),
            "latency_ms_p50": float(np.percentile(latencies, 50)),
            "latency_ms_p95": float(np.percentile(latencies, 95)),
        },
        "models": {
            "bm25": _metrics(truth, bm25),
            "encoder": _metrics(truth, encoder),
            "rrf": _metrics(truth, rrf),
        },
        "agreement": {
            "bm25_encoder_top1_rate": sum(left == right for left, right in zip(bm25, encoder, strict=True)) / len(rows),
            "bm25_encoder_cohen_kappa": _cohen_kappa(bm25, encoder),
            "bm25_encoder_cramers_v": _cramers_v(bm25, encoder),
        },
        "signal_correlation": {
            "fused_share_vs_rrf_correct": _correlation([row["fused_share"] for row in rows], rrf_correct),
            "margin_vs_rrf_correct": _correlation([row["margin"] for row in rows], rrf_correct),
        },
        "selective_gate": {
            "accepted_count": len(accepted),
            "coverage": len(accepted) / len(rows),
            "fallback_count": len(rows) - len(accepted),
            "fallback_rate": 1 - len(accepted) / len(rows),
            "accepted_accuracy": (
                sum(row["accepted_route"] == row["expected"] for row in accepted) / len(accepted)
                if accepted
                else None
            ),
            "accepted_by_expected_route": accepted_by_expected,
            "fallback_reasons": dict(Counter(row["fallback_reason"] for row in rows if row["fallback_reason"])),
        },
        "paired_tests": {
            "bm25_vs_encoder": _exact_mcnemar(truth, bm25, encoder),
            "bm25_vs_rrf": _exact_mcnemar(truth, bm25, rrf),
            "encoder_vs_rrf": _exact_mcnemar(truth, encoder, rrf),
        },
        "cases": rows,
    }


def main() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=(
            repository_root
            / "experiments"
            / "routing_benchmark"
            / "reports"
            / "2026-08-11-a1-vs-luna"
            / "routing_dataset.json"
        ),
    )
    parser.add_argument(
        "--train",
        type=Path,
        default=repository_root / "agent" / "resources" / "routing" / "examples.jsonl",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=repository_root / "experiments" / "routing_benchmark" / "reports" / "2026-08-13-hybrid-rrf",
    )
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = asyncio.run(evaluate(args.dataset.resolve(), args.train.resolve()))
    report_path = args.output_dir / "hybrid_router_evaluation.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    _plot_confusions(report, args.output_dir / "confusion_matrices.png")
    _plot_dashboard(report, args.output_dir / "hybrid_router_dashboard.png")
    summary_keys = (
        "dataset",
        "runtime",
        "models",
        "agreement",
        "signal_correlation",
        "selective_gate",
        "paired_tests",
    )
    print(
        json.dumps(
            {key: report[key] for key in summary_keys},
            ensure_ascii=False,
            indent=2,
        )
    )
    print(report_path)


if __name__ == "__main__":
    main()
