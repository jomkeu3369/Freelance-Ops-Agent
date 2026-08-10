from __future__ import annotations

import json
import time
from typing import Any

import langsmith as ls
from pydantic import BaseModel, ConfigDict, Field

from .routers import calculate_cost


class RoutingJudgeVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    route_score: int = Field(ge=0, le=4)
    groundedness_score: int = Field(ge=0, le=4)
    hallucination_detected: bool
    unsupported_claims: list[str]
    rationale: str = Field(max_length=500)


@ls.traceable(name="routing-llm-judge", run_type="chain")
def judge_prediction(
    client: Any,
    judge_model: str,
    case: dict[str, Any],
    prediction: dict[str, Any],
    routes: dict[str, str],
    pricing: dict[str, Any],
) -> dict[str, Any]:
    payload = {
        "user_request": case["prompt"],
        "reference_route": case["expected_route"],
        "candidate_route": prediction["route"],
        "candidate_confidence": prediction["confidence"],
        "candidate_evidence_signals": prediction["evidence_signals"],
        "candidate_rationale": prediction["rationale"],
        "route_policy": routes,
    }
    started = time.perf_counter()
    response = client.responses.create(
        model=judge_model,
        reasoning={"effort": "none"},
        input=[
            {
                "role": "system",
                "content": "Evaluate an agent execution router. route_score: 4 exactly correct, "
                "3 acceptable under policy ambiguity, 2 ambiguous, 1 likely wrong, 0 unsafe or "
                "clearly wrong. groundedness_score: 4 fully supported by the user request and "
                "route policy, down to 0 unsupported. Detect hallucination when the candidate "
                "rationale or signals introduce facts absent from the request. Do not reveal "
                "private chain-of-thought; provide only a concise evaluation rationale.",
            },
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "routing_judge_verdict",
                "strict": True,
                "schema": RoutingJudgeVerdict.model_json_schema(),
            }
        },
    )
    latency_ms = (time.perf_counter() - started) * 1_000
    verdict = RoutingJudgeVerdict.model_validate_json(response.output_text)
    input_tokens = int(response.usage.input_tokens or 0)
    output_tokens = int(response.usage.output_tokens or 0)
    return {
        "judge_model": judge_model,
        **verdict.model_dump(),
        "latency_ms": latency_ms,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": calculate_cost(judge_model, input_tokens, output_tokens, pricing),
    }


def aggregate_verdicts(verdicts: list[dict[str, Any]], minimum_pass_score: int) -> dict[str, Any]:
    if len(verdicts) != 1 or verdicts[0]["judge_model"] != "gpt-5.6-luna":
        raise ValueError("Exactly one gpt-5.6-luna verdict is required")
    verdict = verdicts[0]
    route_score = int(verdict["route_score"])
    groundedness = int(verdict["groundedness_score"])
    return {
        "route_pass": route_score >= minimum_pass_score,
        "route_score": route_score,
        "groundedness_score": groundedness,
        "groundless_rate": 1 - groundedness / 4,
        "hallucination_detected": bool(verdict["hallucination_detected"])
    }
