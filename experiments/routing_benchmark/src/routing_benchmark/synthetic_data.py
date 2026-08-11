from __future__ import annotations

import json
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .config import RoutingConfig
from .routers import RouteLabel, build_openai_client, calculate_cost


class SyntheticCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=8, max_length=600)
    expected_route: RouteLabel
    language: Literal["ko", "en"]
    risk_level: Literal["low", "medium", "high"]
    boundary_route: RouteLabel | None
    label_reason: str = Field(min_length=8, max_length=240)


class SyntheticBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cases: list[SyntheticCase]


def _normalize(text: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]+", " ", text.casefold()).strip()


def _token_set(text: str) -> set[str]:
    return set(_normalize(text).split())


def _near_duplicate(prompt: str, existing: list[str]) -> bool:
    candidate = _token_set(prompt)
    if not candidate:
        return True
    for other in existing:
        reference = _token_set(other)
        union = candidate | reference
        if union and len(candidate & reference) / len(union) >= 0.9:
            return True
    return False


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _append_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")


def normalize_generated_data(config: RoutingConfig) -> Path:
    settings = config.synthetic_data
    output_dir = (config.root / settings["output_dir"]).resolve()
    rng = random.Random(int(config.seed))
    report: dict[str, Any] = {"schema_version": "1.0", "splits": {}}
    test_prompts: set[str] = set()
    for test_path in (config.root / "reports").glob("*/routing_dataset.json"):
        payload = json.loads(test_path.read_text(encoding="utf-8"))
        test_prompts.update(_normalize(case["prompt"]) for case in payload.get("cases", []))

    for split, per_route in (
        ("train", int(settings["train_per_route"])),
        ("validation", int(settings["validation_per_route"])),
    ):
        path = output_dir / f"{split}.jsonl"
        original = _read_jsonl(path)
        selected: list[dict[str, Any]] = []
        split_report: dict[str, Any] = {}
        for route in config.routes:
            unique: dict[str, dict[str, Any]] = {}
            for row in original:
                if row["expected_route"] == route:
                    unique.setdefault(_normalize(row["prompt"]), row)
            candidates = list(unique.values())
            rng.shuffle(candidates)
            if len(candidates) < per_route:
                raise ValueError(
                    f"After deduplication {split}/{route} has {len(candidates)} rows; "
                    f"requires {per_route}"
                )
            for index, row in enumerate(candidates[:per_route]):
                row["id"] = f"synthetic-{split}-{route.lower()}-{index:04d}"
                selected.append(row)
            chosen = candidates[:per_route]
            split_report[route] = {
                "rows": len(chosen),
                "korean": sum(row["language"] == "ko" for row in chosen),
                "english": sum(row["language"] == "en" for row in chosen),
                "hard_boundaries": sum(row["boundary_route"] is not None for row in chosen),
                "frozen_test_exact_overlap": sum(
                    _normalize(row["prompt"]) in test_prompts for row in chosen
                ),
            }
        rng.shuffle(selected)
        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in selected),
            encoding="utf-8",
        )
        report["splits"][split] = split_report

    report_path = output_dir / "quality_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report_path


def _generation_prompt(
    route: str,
    routes: dict[str, str],
    split: str,
    count: int,
    batch_number: int,
) -> str:
    policy = "\n".join(f"- {name}: {description}" for name, description in routes.items())
    return f"""Create exactly {count} distinct user requests for a routing classifier.

Target route: {route}
Dataset split: {split}
Batch number: {batch_number}

Route policy:
{policy}

Requirements:
- Every case must unambiguously require the target route under the policy.
- Produce approximately half Korean and half English prompts.
- Mix freelance software work, CRM, project planning, quotation, authentication, files,
  research, support, billing, and general assistant scenarios.
- Include short, medium, and long requests and realistic typos or incomplete wording in at
  most 15 percent of cases.
- At least 40 percent must be hard boundary cases against one other route, recorded in
  boundary_route.
- For DIRECT_TOOL, all operands or lookup keys must already be provided and deterministic.
- For SIMPLE_LLM, no current external information or action may be required.
- For REACT_AGENT, require bounded tool use in one specialist domain; do not make approval
  or legal authority necessary.
- For SUPERVISOR, explicitly require two or more specialist domains with dependent outputs.
- For HUMAN_REQUIRED, make approval, identity verification, legal authority, privacy,
  irreversible external impact, or ambiguous delegated authority explicit.
- Do not include route names in the user-facing prompt.
- Do not copy benchmark examples, include personal data, secrets, or private chain-of-thought.
- label_reason must be one concise observable policy justification, not hidden reasoning.
"""


def _request_batch(
    client: Any,
    model: str,
    route: str,
    routes: dict[str, str],
    split: str,
    count: int,
    batch_number: int,
) -> Any:
    return client.responses.create(
        model=model,
        reasoning={"effort": "none"},
        input=[
            {
                "role": "system",
                "content": "Generate labeled classifier data only. Follow the supplied routing "
                "policy literally. Return concise structured data and no chain-of-thought.",
            },
            {
                "role": "user",
                "content": _generation_prompt(route, routes, split, count, batch_number),
            },
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "routing_synthetic_batch",
                "strict": True,
                "schema": SyntheticBatch.model_json_schema(),
            }
        },
    )


def generate_training_data(config: RoutingConfig) -> Path:
    settings = config.synthetic_data
    output_dir = (config.root / settings["output_dir"]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    pricing = json.loads((config.root / config.pricing_file).read_text(encoding="utf-8"))
    client = build_openai_client()
    model = settings["generator_model"]
    batch_size = int(settings["batch_size"])
    total_input_tokens = 0
    total_output_tokens = 0
    total_cost = 0.0
    started = time.perf_counter()

    for split, per_route in (
        ("train", int(settings["train_per_route"])),
        ("validation", int(settings["validation_per_route"])),
    ):
        path = output_dir / f"{split}.jsonl"
        rows = _read_jsonl(path)
        by_route = {
            route: [row for row in rows if row["expected_route"] == route]
            for route in config.routes
        }
        existing_prompts = [row["prompt"] for row in rows]

        for route in config.routes:
            batch_number = len(by_route[route]) // batch_size
            attempts_without_progress = 0
            while len(by_route[route]) < per_route:
                remaining = per_route - len(by_route[route])
                call_count = min(5, (remaining + batch_size - 1) // batch_size)
                counts = [
                    min(batch_size, remaining - index * batch_size) for index in range(call_count)
                ]
                batch_numbers = [batch_number + index + 1 for index in range(call_count)]
                with ThreadPoolExecutor(max_workers=call_count) as executor:
                    responses = list(
                        executor.map(
                            lambda spec, current_route=route, current_split=split: _request_batch(
                                client,
                                model,
                                current_route,
                                config.routes,
                                current_split,
                                spec[0],
                                spec[1],
                            ),
                            zip(counts, batch_numbers),
                        )
                    )
                batch_number += call_count
                accepted: list[dict[str, Any]] = []
                for response, response_batch in zip(responses, batch_numbers):
                    total_input_tokens += int(response.usage.input_tokens or 0)
                    total_output_tokens += int(response.usage.output_tokens or 0)
                    parsed = SyntheticBatch.model_validate_json(response.output_text)
                    for item in parsed.cases:
                        if item.expected_route != route:
                            continue
                        if any(name.casefold() in item.prompt.casefold() for name in config.routes):
                            continue
                        if _near_duplicate(item.prompt, existing_prompts):
                            continue
                        row = {
                            "id": f"synthetic-{split}-{route.lower()}-{len(by_route[route]):04d}",
                            **item.model_dump(),
                            "split": split,
                            "source": f"openai:{model}",
                            "generator_batch": response_batch,
                            "dataset_version": "generated-v1",
                        }
                        accepted.append(row)
                        by_route[route].append(row)
                        existing_prompts.append(item.prompt)
                        if len(by_route[route]) >= per_route:
                            break
                    if len(by_route[route]) >= per_route:
                        break

                _append_jsonl(path, accepted)
                attempts_without_progress = 0 if accepted else attempts_without_progress + 1
                print(
                    f"generated {split} {route}: {len(by_route[route])}/{per_route} "
                    f"(accepted {len(accepted)})",
                    flush=True,
                )
                if attempts_without_progress >= 3:
                    raise RuntimeError(f"No valid new cases generated for {split}/{route}")

    total_cost = calculate_cost(model, total_input_tokens, total_output_tokens, pricing)
    report = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "generator_model": model,
        "routes": list(config.routes),
        "train_rows": len(_read_jsonl(output_dir / "train.jsonl")),
        "validation_rows": len(_read_jsonl(output_dir / "validation.jsonl")),
        "input_tokens": total_input_tokens,
        "output_tokens": total_output_tokens,
        "cost_usd_this_run": total_cost,
        "elapsed_seconds": time.perf_counter() - started,
        "frozen_test_excluded": True,
    }
    report_path = output_dir / "generation_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    normalize_generated_data(config)
    return report_path
