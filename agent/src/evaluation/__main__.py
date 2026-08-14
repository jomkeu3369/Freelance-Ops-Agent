"""CLI for producing a versioned deterministic V2 evaluation report."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from .report import EvaluationCase, build_evaluation_report


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the V2 section 14.4 evaluation report")
    parser.add_argument("--input", type=Path, required=True, help="JSON array or JSONL evaluation cases")
    parser.add_argument("--output", type=Path, required=True, help="Output report JSON path")
    parser.add_argument("--dataset-version", required=True)
    parser.add_argument("--evaluated-at", help="ISO-8601 timestamp; defaults to current UTC")
    args = parser.parse_args()

    cases = _load_cases(args.input)
    evaluated_at = (
        datetime.fromisoformat(args.evaluated_at.replace("Z", "+00:00"))
        if args.evaluated_at
        else datetime.now(UTC)
    )
    if evaluated_at.tzinfo is None:
        raise ValueError("evaluated-at must include a timezone")
    report = build_evaluation_report(
        cases,
        dataset_version=args.dataset_version,
        evaluated_at=evaluated_at,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report.model_dump_json(indent=2), encoding="utf-8")
    return 0


def _load_cases(path: Path) -> list[EvaluationCase]:
    raw = path.read_text(encoding="utf-8")
    if raw.lstrip().startswith("["):
        values = json.loads(raw)
    else:
        values = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if not isinstance(values, list):
        raise ValueError("evaluation input must be a JSON array or JSONL")
    return [EvaluationCase.model_validate(value) for value in values]


if __name__ == "__main__":
    raise SystemExit(main())
