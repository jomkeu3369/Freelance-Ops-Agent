from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _router_summary(report: dict[str, Any]) -> pd.DataFrame:
    rows = []
    for router in report["routers"]:
        metrics = router["metrics"]
        sample_count = len(router["predictions"])
        rows.append(
            {
                "router": router["name"],
                "model_id": router["model_id"],
                "samples": sample_count,
                "accuracy": metrics["accuracy"],
                "macro_f1": metrics["macro_f1"],
                "mean_latency_ms": metrics["mean_ms"],
                "p50_latency_ms": metrics["p50_ms"],
                "p95_latency_ms": metrics["p95_ms"],
                "throughput_per_second": metrics["throughput_per_second"],
                "total_cost_usd": metrics["total_cost_usd"],
                "cost_per_1000_requests_usd": metrics["total_cost_usd"]
                / max(sample_count, 1)
                * 1_000,
                "model_load_seconds": metrics.get("model_load_seconds", 0.0),
                "parameter_memory_mb": metrics.get("parameter_memory_mb", 0.0),
                "peak_cuda_memory_mb": metrics.get("peak_cuda_memory_mb", 0.0),
                "device": metrics.get("device", "remote_api")
            }
        )
    return pd.DataFrame(rows)


def _per_route_summary(report: dict[str, Any]) -> pd.DataFrame:
    rows = []
    for router in report["routers"]:
        for route, metrics in router["metrics"]["per_route"].items():
            rows.append(
                {
                    "router": router["name"],
                    "route": route,
                    "precision": metrics["precision"],
                    "recall": metrics["recall"],
                    "f1": metrics["f1-score"],
                    "support": int(metrics["support"])
                }
            )
    return pd.DataFrame(rows)


def _judge_summary(report: dict[str, Any]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"router": router, **metrics}
            for router, metrics in report["router_summaries"].items()
        ]
    )


def export_tables(ab_report: Path, judge_report: Path | None, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    ab_payload = _load(ab_report)
    router_frame = _router_summary(ab_payload)
    route_frame = _per_route_summary(ab_payload)
    outputs = [output_dir / "router_summary.csv", output_dir / "per_route_metrics.csv"]
    router_frame.to_csv(outputs[0], index=False, encoding="utf-8-sig")
    route_frame.to_csv(outputs[1], index=False, encoding="utf-8-sig")

    summary: dict[str, Any] = {
        "router_summary": router_frame.to_dict(orient="records"),
        "per_route_metrics": route_frame.to_dict(orient="records"),
        "mcnemar_exact": ab_payload["ab_test"]
    }
    if judge_report:
        judge_frame = _judge_summary(_load(judge_report))
        judge_path = output_dir / "luna_judge_summary.csv"
        judge_frame.to_csv(judge_path, index=False, encoding="utf-8-sig")
        outputs.append(judge_path)
        summary["luna_judge_summary"] = judge_frame.to_dict(orient="records")

    summary_path = output_dir / "pandas_summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    outputs.append(summary_path)
    print(router_frame.to_string(index=False))
    if judge_report:
        print(_judge_summary(_load(judge_report)).to_string(index=False))
    return outputs
