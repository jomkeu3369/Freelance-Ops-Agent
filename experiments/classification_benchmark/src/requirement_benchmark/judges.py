from __future__ import annotations

import json
import statistics
import time
from pathlib import Path
from typing import Any

import langsmith as ls
from pydantic import BaseModel, ConfigDict, Field


class JudgeVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    classification_score: int = Field(ge=0, le=4)
    groundedness_score: int = Field(ge=0, le=4)
    hallucination_detected: bool
    unsupported_claims: list[str]
    rationale: str = Field(max_length=600)


JUDGE_SYSTEM = """You are an independent evaluator of a software-requirement classifier.
Evaluate only from the requirement text, the reference label, and these definitions:
- FUNCTIONAL: behavior, capability, input/output, or service the system must provide.
- NON_FUNCTIONAL: quality attribute, constraint, performance, security, usability, reliability,
  compliance, or implementation restriction.

classification_score: 4 exact and unambiguous; 3 correct with minor ambiguity; 2 genuinely
ambiguous; 1 likely wrong; 0 clearly wrong.
groundedness_score: 4 fully supported by the requirement; 3 mostly supported; 2 mixed or
ambiguous; 1 weakly supported; 0 unsupported. A prediction can be ungrounded even when it
accidentally matches the reference. Mark hallucination_detected when the candidate label or
its stated basis introduces unsupported meaning. Keep rationale concise; do not reveal hidden
reasoning or chain-of-thought."""


def calculate_openai_cost(
    model: str, input_tokens: int, output_tokens: int, pricing: dict[str, Any]
) -> float:
    rates = pricing["models"][model]
    return (input_tokens * rates["input"] + output_tokens * rates["output"]) / 1_000_000


def load_pricing(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def aggregate_verdicts(verdicts: list[dict[str, Any]], minimum_pass_score: int) -> dict[str, Any]:
    if len(verdicts) != 3:
        raise ValueError("Three judge verdicts are required for aggregation")
    class_scores = [int(item["classification_score"]) for item in verdicts]
    ground_scores = [int(item["groundedness_score"]) for item in verdicts]
    hallucination_votes = [bool(item["hallucination_detected"]) for item in verdicts]
    return {
        "classification_score_median": float(statistics.median(class_scores)),
        "groundedness_score_median": float(statistics.median(ground_scores)),
        "classification_pass": sum(score >= minimum_pass_score for score in class_scores) >= 2,
        "hallucination_detected": sum(hallucination_votes) >= 2,
        "groundless_rate": 1.0 - float(statistics.median(ground_scores)) / 4.0,
        "classification_disagreement_stdev": float(statistics.pstdev(class_scores)),
        "unanimous": len(set(class_scores)) == 1 and len(set(hallucination_votes)) == 1,
    }


def build_openai_client() -> Any:
    from openai import OpenAI

    client: Any = OpenAI()
    try:
        from langsmith.wrappers import wrap_openai

        client = wrap_openai(client)
    except ImportError:
        pass
    return client


@ls.traceable(name="requirement-classifier-judge", run_type="chain")
def evaluate_prediction(
    client: Any,
    model: str,
    prediction: dict[str, Any],
    pricing: dict[str, Any],
) -> dict[str, Any]:
    user_input = json.dumps(
        {
            "requirement": prediction["text"],
            "reference_label": prediction["reference_label"],
            "candidate_label": prediction["predicted_label"],
            "candidate_confidence": prediction["confidence"],
        },
        ensure_ascii=False,
    )
    started = time.perf_counter()
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": user_input},
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "requirement_classifier_judge",
                "strict": True,
                "schema": JudgeVerdict.model_json_schema(),
            }
        },
    )
    elapsed_ms = (time.perf_counter() - started) * 1_000
    verdict = JudgeVerdict.model_validate_json(response.output_text)
    input_tokens = int(getattr(response.usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(response.usage, "output_tokens", 0) or 0)
    return {
        "judge_model": model,
        **verdict.model_dump(),
        "latency_ms": elapsed_ms,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": calculate_openai_cost(model, input_tokens, output_tokens, pricing),
    }


def estimate_judge_plan(judges: dict[str, Any], pricing: dict[str, Any]) -> dict[str, Any]:
    predictions = int(judges["max_samples_per_classifier"]) * 2
    input_tokens = int(judges["estimated_input_tokens_per_call"])
    output_tokens = int(judges["estimated_output_tokens_per_call"])
    by_model = {
        model: {
            "calls": predictions,
            "estimated_cost_usd": predictions
            * calculate_openai_cost(model, input_tokens, output_tokens, pricing),
        }
        for model in judges["models"]
    }
    return {
        "classifier_predictions": predictions,
        "total_calls": predictions * len(judges["models"]),
        "assumed_input_tokens_per_call": input_tokens,
        "assumed_output_tokens_per_call": output_tokens,
        "by_model": by_model,
        "estimated_total_cost_usd": sum(item["estimated_cost_usd"] for item in by_model.values()),
        "warning": "Estimate only; billing uses actual token usage and current provider pricing.",
    }
