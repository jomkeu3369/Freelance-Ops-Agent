from __future__ import annotations

import json
import os
import platform
import random
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .classifier import train_and_benchmark
from .config import BenchmarkConfig
from .dataset import load_requirement_dataset, stratified_limit
from .judges import (
    aggregate_verdicts,
    build_openai_client,
    estimate_judge_plan,
    evaluate_prediction,
    load_pricing,
)
from .metrics import bootstrap_f1_delta, exact_mcnemar


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def select_paired_prediction_ids(
    classifiers: list[dict[str, Any]], max_samples: int, *, seed: int
) -> list[str]:
    """Select one deterministic set of IDs shared by every A/B classifier."""
    common_ids = set.intersection(
        *[{prediction["id"] for prediction in item["predictions"]} for item in classifiers]
    )
    ordered_ids = [
        prediction["id"]
        for prediction in classifiers[0]["predictions"]
        if prediction["id"] in common_ids
    ]
    random.Random(seed).shuffle(ordered_ids)
    return ordered_ids[:max_samples]


def run_local_ab(config: BenchmarkConfig, output_dir: Path) -> Path:
    splits = load_requirement_dataset(config.dataset)
    limits = {
        "train": config.training.get("max_train_samples"),
        "validation": config.training.get("max_validation_samples"),
        "test": config.training.get("max_test_samples"),
    }
    splits = {
        name: stratified_limit(rows, limits[name], seed=int(config.training["seed"]))
        for name, rows in splits.items()
    }
    label_names = config.dataset["label_names"]
    runs = []
    for model in config.classifiers:
        run = train_and_benchmark(model, splits, config.training, label_names)
        runs.append(run)
        _write_json(
            output_dir / f"partial_{run.name}.json",
            {"name": run.name, "model_id": run.model_id, "metrics": run.metrics},
        )
    truth = [item["reference_label_id"] for item in runs[0].predictions]
    pred_a = [item["predicted_label_id"] for item in runs[0].predictions]
    pred_b = [item["predicted_label_id"] for item in runs[1].predictions]
    report = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "dataset": {**config.dataset, "split_sizes": {key: len(value) for key, value in splits.items()}},
        "environment": {"python": sys.version, "platform": platform.platform()},
        "classifiers": [
            {
                "name": run.name,
                "model_id": run.model_id,
                "metrics": run.metrics,
                "predictions": run.predictions,
            }
            for run in runs
        ],
        "ab_test": {
            "mcnemar_exact": exact_mcnemar(truth, pred_a, pred_b),
            "bootstrap": bootstrap_f1_delta(truth, pred_a, pred_b, seed=config.training["seed"]),
            "interpretation": "A macro-F1 delta CI that excludes 0 supports a difference; positive "
            "delta favors B and negative delta favors A. McNemar p < 0.05 supports a difference "
            "in paired error rates.",
        },
    }
    path = output_dir / "local_ab.json"
    _write_json(path, report)
    return path


def run_judges(
    config: BenchmarkConfig,
    local_report_path: Path,
    output_dir: Path,
    resume_report_path: Path | None = None,
) -> Path:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required for paid judge calls")
    report = json.loads(local_report_path.read_text(encoding="utf-8"))
    pricing = load_pricing(config.root / config.judges["pricing_file"])
    client = build_openai_client()
    judged: list[dict[str, Any]] = []
    max_samples = int(config.judges["max_samples_per_classifier"])
    selected_ids = select_paired_prediction_ids(
        report["classifiers"], max_samples, seed=int(config.training["seed"])
    )
    selected_order = {prediction_id: index for index, prediction_id in enumerate(selected_ids)}
    reusable: dict[tuple[str, str], dict[str, Any]] = {}
    if resume_report_path and resume_report_path.exists():
        previous = json.loads(resume_report_path.read_text(encoding="utf-8"))
        reusable = {
            (row["classifier"], row["prediction_id"]): row
            for row in previous.get("items", [])
            if [verdict["judge_model"] for verdict in row.get("verdicts", [])]
            == config.judges["models"]
        }
    reused_calls = 0
    new_calls = 0
    for classifier in report["classifiers"]:
        candidates = [
            prediction
            for prediction in classifier["predictions"]
            if prediction["id"] in selected_order
        ]
        candidates.sort(key=lambda prediction: selected_order[prediction["id"]])
        for prediction in candidates:
            cached = reusable.get((classifier["name"], prediction["id"]))
            if cached:
                judged.append(cached)
                reused_calls += len(cached["verdicts"])
                continue
            verdicts = [
                evaluate_prediction(client, model, prediction, pricing)
                for model in config.judges["models"]
            ]
            new_calls += len(verdicts)
            judged.append(
                {
                    "classifier": classifier["name"],
                    "prediction_id": prediction["id"],
                    "verdicts": verdicts,
                    "aggregate": aggregate_verdicts(
                        verdicts, int(config.judges["minimum_pass_score"])
                    ),
                }
            )
    summaries: dict[str, Any] = {}
    for classifier in report["classifiers"]:
        rows = [row for row in judged if row["classifier"] == classifier["name"]]
        verdicts = [verdict for row in rows for verdict in row["verdicts"]]
        summaries[classifier["name"]] = {
            "samples": len(rows),
            "judge_calls": len(verdicts),
            "classification_pass_rate": sum(row["aggregate"]["classification_pass"] for row in rows)
            / max(len(rows), 1),
            "hallucination_rate": sum(row["aggregate"]["hallucination_detected"] for row in rows)
            / max(len(rows), 1),
            "mean_groundless_rate": sum(row["aggregate"]["groundless_rate"] for row in rows)
            / max(len(rows), 1),
            "total_cost_usd": sum(verdict["cost_usd"] for verdict in verdicts),
            "mean_judge_latency_ms": sum(verdict["latency_ms"] for verdict in verdicts)
            / max(len(verdicts), 1),
        }
    judge_model_summaries: dict[str, Any] = {}
    for judge_model in config.judges["models"]:
        verdicts = [
            verdict
            for row in judged
            for verdict in row["verdicts"]
            if verdict["judge_model"] == judge_model
        ]
        judge_model_summaries[judge_model] = {
            "calls": len(verdicts),
            "total_cost_usd": sum(verdict["cost_usd"] for verdict in verdicts),
            "mean_latency_ms": sum(verdict["latency_ms"] for verdict in verdicts)
            / max(len(verdicts), 1),
            "mean_input_tokens": sum(verdict["input_tokens"] for verdict in verdicts)
            / max(len(verdicts), 1),
            "mean_output_tokens": sum(verdict["output_tokens"] for verdict in verdicts)
            / max(len(verdicts), 1),
        }
    output = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "pricing_snapshot": pricing,
        "judges": config.judges["models"],
        "paired_prediction_ids": selected_ids,
        "reused_calls": reused_calls,
        "new_calls": new_calls,
        "summaries": summaries,
        "judge_model_summaries": judge_model_summaries,
        "items": judged,
    }
    path = output_dir / "judge_ab.json"
    _write_json(path, output)
    return path


def judge_cost_estimate(config: BenchmarkConfig) -> dict[str, Any]:
    pricing = load_pricing(config.root / config.judges["pricing_file"])
    return {"pricing_snapshot": pricing, "plan": estimate_judge_plan(config.judges, pricing)}
