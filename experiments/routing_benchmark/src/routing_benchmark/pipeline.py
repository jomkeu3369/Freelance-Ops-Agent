from __future__ import annotations

import json
import os
import random
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import RoutingConfig
from .dataset import build_routing_cases
from .judges import aggregate_verdicts, judge_prediction
from .metrics import exact_mcnemar, latency_metrics, routing_metrics
from .routers import LiquidEncoderRouter, build_openai_client, predict_with_llm


def _write_json(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _load_pricing(config: RoutingConfig) -> dict[str, Any]:
    return json.loads((config.root / config.pricing_file).read_text(encoding="utf-8"))


def build_dataset_report(config: RoutingConfig, output_dir: Path) -> Path:
    cases = build_routing_cases(int(config.samples_per_route), int(config.seed))
    return _write_json(
        output_dir / "routing_dataset.json",
        {
            "schema_version": "1.0",
            "created_at": datetime.now(UTC).isoformat(),
            "routes": config.routes,
            "cases": [case.to_dict() for case in cases],
        },
    )


def run_router_ab(config: RoutingConfig, output_dir: Path) -> Path:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required for prompt-LLM router B")
    dataset_path = build_dataset_report(config, output_dir)
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    cases = dataset["cases"]
    pricing = _load_pricing(config)
    router_a = LiquidEncoderRouter(config.router_a, config.routes)
    client = build_openai_client()
    router_a.predict(cases[0]["prompt"])
    predictions: dict[str, list[dict[str, Any]]] = {
        config.router_a["name"]: [],
        config.router_b["name"]: [],
    }
    for index, case in enumerate(cases, start=1):
        predictions[config.router_a["name"]].append(
            {"case_id": case["id"], **router_a.predict(case["prompt"])}
        )
        predictions[config.router_b["name"]].append(
            {
                "case_id": case["id"],
                **predict_with_llm(client, config.router_b, config.routes, case["prompt"], pricing),
            }
        )
        if index % 10 == 0:
            print(f"routed {index}/{len(cases)} cases")

    labels = list(config.routes)
    truth = [case["expected_route"] for case in cases]
    routers = []
    for name, model_config in (
        (config.router_a["name"], config.router_a),
        (config.router_b["name"], config.router_b),
    ):
        rows = predictions[name]
        metrics = routing_metrics(truth, [row["route"] for row in rows], labels)
        metrics.update(latency_metrics([row["latency_ms"] for row in rows]))
        metrics["total_cost_usd"] = sum(row["cost_usd"] for row in rows)
        metrics["total_input_tokens"] = sum(row["input_tokens"] for row in rows)
        metrics["total_output_tokens"] = sum(row["output_tokens"] for row in rows)
        routers.append(
            {
                "name": name,
                "model_id": model_config["model_id"],
                "metrics": metrics,
                "predictions": rows,
            }
        )
    router_a_metrics = routers[0]["metrics"]
    router_a_metrics["model_load_seconds"] = router_a.load_seconds
    router_a_metrics["parameter_memory_mb"] = router_a.parameter_memory_mb
    router_a_metrics["device"] = str(router_a.device)
    router_a_metrics["peak_cuda_memory_mb"] = torch_peak_memory_mb()
    report = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "dataset_path": dataset_path.name,
        "routes": config.routes,
        "cases": cases,
        "routers": routers,
        "ab_test": exact_mcnemar(
            truth,
            [row["route"] for row in predictions[config.router_a["name"]]],
            [row["route"] for row in predictions[config.router_b["name"]]],
        ),
        "pricing_snapshot": pricing,
    }
    return _write_json(output_dir / "router_ab.json", report)


def torch_peak_memory_mb() -> float:
    import torch

    return torch.cuda.max_memory_allocated() / 1024**2 if torch.cuda.is_available() else 0.0


def run_judges(config: RoutingConfig, ab_report_path: Path, output_dir: Path) -> Path:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required for judge calls")
    report = json.loads(ab_report_path.read_text(encoding="utf-8"))
    pricing = _load_pricing(config)
    client = build_openai_client()
    rng = random.Random(int(config.seed))
    route_labels = list(config.routes)
    judge_sample_count = int(config.judge_sample_count)
    if judge_sample_count % len(route_labels) != 0:
        raise ValueError("judge_sample_count must be divisible by the number of routes")
    per_route = judge_sample_count // len(route_labels)
    selected_ids: list[str] = []
    for route in route_labels:
        route_ids = [case["id"] for case in report["cases"] if case["expected_route"] == route]
        selected_ids.extend(rng.sample(route_ids, per_route))
    rng.shuffle(selected_ids)
    cases = {case["id"]: case for case in report["cases"]}
    judged: list[dict[str, Any]] = []
    for router in report["routers"]:
        predictions = {row["case_id"]: row for row in router["predictions"]}
        for case_id in selected_ids:
            verdicts = [
                judge_prediction(
                    client,
                    judge_model,
                    cases[case_id],
                    predictions[case_id],
                    config.routes,
                    pricing,
                )
                for judge_model in config.judges["models"]
            ]
            judged.append(
                {
                    "router": router["name"],
                    "case_id": case_id,
                    "verdicts": verdicts,
                    "aggregate": aggregate_verdicts(
                        verdicts, int(config.judges["minimum_pass_score"])
                    ),
                }
            )
    router_summaries: dict[str, Any] = {}
    for router in report["routers"]:
        rows = [row for row in judged if row["router"] == router["name"]]
        verdicts = [verdict for row in rows for verdict in row["verdicts"]]
        router_summaries[router["name"]] = {
            "samples": len(rows),
            "route_pass_rate": sum(row["aggregate"]["route_pass"] for row in rows) / len(rows),
            "mean_groundless_rate": sum(row["aggregate"]["groundless_rate"] for row in rows)
            / len(rows),
            "hallucination_rate": sum(row["aggregate"]["hallucination_detected"] for row in rows)
            / len(rows),
            "judge_cost_usd": sum(verdict["cost_usd"] for verdict in verdicts),
        }
    judge_summaries = {}
    for model in config.judges["models"]:
        rows = [v for item in judged for v in item["verdicts"] if v["judge_model"] == model]
        judge_summaries[model] = {
            "calls": len(rows),
            "cost_usd": sum(row["cost_usd"] for row in rows),
            "mean_latency_ms": sum(row["latency_ms"] for row in rows) / len(rows),
        }
    return _write_json(
        output_dir / "judge_ab.json",
        {
            "schema_version": "1.0",
            "created_at": datetime.now(UTC).isoformat(),
            "paired_case_ids": selected_ids,
            "router_summaries": router_summaries,
            "judge_summaries": judge_summaries,
            "items": judged,
            "pricing_snapshot": pricing,
        },
    )
