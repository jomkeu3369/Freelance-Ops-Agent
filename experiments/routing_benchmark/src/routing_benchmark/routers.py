from __future__ import annotations

import json
import time
from typing import Any, Literal

import langsmith as ls
from pydantic import BaseModel, ConfigDict, Field

RouteLabel = Literal["DIRECT_TOOL", "SIMPLE_LLM", "REACT_AGENT", "SUPERVISOR", "HUMAN_REQUIRED"]


class LLMRouteDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    route: RouteLabel
    confidence: float = Field(ge=0, le=1)
    evidence_signals: list[str] = Field(max_length=5)
    rationale: str = Field(max_length=400)


def calculate_cost(
    model: str, input_tokens: int, output_tokens: int, pricing: dict[str, Any]
) -> float:
    rates = pricing["models"][model]
    return (input_tokens * rates["input"] + output_tokens * rates["output"]) / 1_000_000


class LiquidEncoderRouter:
    def __init__(self, model_config: dict[str, Any], routes: dict[str, str]) -> None:
        import torch
        from transformers import AutoModel, AutoTokenizer

        self._torch = torch

        requested_device = str(model_config["device"])
        if requested_device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA is required for the LiquidAI benchmark")

        if requested_device not in {"auto", "cpu", "cuda"}:
            raise ValueError("LiquidAI device must be one of: auto, cpu, cuda")

        selected_device = (
            "cuda"
            if requested_device == "cuda"
            or (requested_device == "auto" and torch.cuda.is_available())
            else "cpu"
        )

        self.device = torch.device(selected_device)
        started = time.perf_counter()

        self.tokenizer = AutoTokenizer.from_pretrained(
            model_config["model_id"], revision=model_config["revision"], trust_remote_code=True
        )

        self.model = AutoModel.from_pretrained(
            model_config["model_id"], revision=model_config["revision"], trust_remote_code=True
        )
        head_path = model_config.get("head_path")
        if head_path:
            from safetensors.torch import load_file

            missing, unexpected = self.model.load_state_dict(load_file(head_path), strict=False)
            allowed_missing = [name for name in missing if not name.startswith("lfm2.")]
            if allowed_missing or unexpected:
                raise RuntimeError(
                    f"Invalid routing head: missing={allowed_missing}, unexpected={unexpected}"
                )
        self.model = self.model.eval().to(self.device)
        self.head_path = head_path

        self._synchronize()
        self.load_seconds = time.perf_counter() - started
        self.parameter_memory_mb = (
            sum(
                parameter.numel() * parameter.element_size()
                for parameter in self.model.parameters()
            )
            / 1024**2
        )
        self.route_lanes = [f"{label}: {description}" for label, description in routes.items()]

    def predict(self, prompt: str) -> dict[str, Any]:
        self._synchronize()

        started = time.perf_counter()
        with self._torch.inference_mode():
            scores = self.model.route(prompt, self.route_lanes, tokenizer=self.tokenizer)

        self._synchronize()

        latency_ms = (time.perf_counter() - started) * 1_000
        best = scores[0]
        route = str(best["route"]).split(":", 1)[0]

        return {
            "route": route,
            "confidence": float(best["score"]),
            "evidence_signals": [
                f"{str(item['route']).split(':', 1)[0]}={float(item['score']):.4f}"
                for item in scores[:3]
            ],
            "rationale": (
                "Fine-tuned encoder lane scores; no generated reasoning."
                if self.head_path
                else "Zero-shot encoder lane scores; no generated reasoning."
            ),
            "latency_ms": latency_ms,
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0.0,
        }

    def _synchronize(self) -> None:
        if self.device.type == "cuda":
            self._torch.cuda.synchronize()


def build_openai_client() -> Any:
    from langsmith.wrappers import wrap_openai
    from openai import OpenAI

    return wrap_openai(OpenAI())


@ls.traceable(name="prompt-llm-router", run_type="chain")
def predict_with_llm(
    client: Any,
    model_config: dict[str, Any],
    routes: dict[str, str],
    prompt: str,
    pricing: dict[str, Any],
) -> dict[str, Any]:
    policy = "\n".join(f"- {label}: {description}" for label, description in routes.items())
    user_input = json.dumps({"user_request": prompt}, ensure_ascii=False)
    started = time.perf_counter()
    response = client.responses.create(
        model=model_config["model_id"],
        reasoning={"effort": model_config["reasoning_effort"]},
        input=[
            {
                "role": "system",
                "content": "You are a deterministic pre-routing classifier. Select exactly one "
                "execution route from the policy. Use the least complex route that safely completes "
                "the request. Do not execute the request.\n\n" + policy,
            },
            {"role": "user", "content": user_input},
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "agent_route_decision",
                "strict": True,
                "schema": LLMRouteDecision.model_json_schema(),
            }
        },
    )
    latency_ms = (time.perf_counter() - started) * 1_000
    decision = LLMRouteDecision.model_validate_json(response.output_text)
    input_tokens = int(response.usage.input_tokens or 0)
    output_tokens = int(response.usage.output_tokens or 0)
    return {
        **decision.model_dump(),
        "latency_ms": latency_ms,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": calculate_cost(model_config["model_id"], input_tokens, output_tokens, pricing),
    }
