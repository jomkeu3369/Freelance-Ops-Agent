import json
from types import SimpleNamespace

from requirement_benchmark.judges import (
    JudgeVerdict,
    aggregate_verdicts,
    calculate_openai_cost,
    estimate_judge_plan,
    evaluate_prediction,
)


def test_cost_uses_actual_tokens() -> None:
    pricing = {"models": {"judge": {"input": 2.0, "output": 10.0}}}
    assert calculate_openai_cost("judge", 1_000_000, 500_000, pricing) == 7.0


def test_three_judge_majority_and_groundless_rate() -> None:
    verdicts = [
        {"classification_score": 4, "groundedness_score": 4, "hallucination_detected": False},
        {"classification_score": 3, "groundedness_score": 3, "hallucination_detected": False},
        {"classification_score": 1, "groundedness_score": 1, "hallucination_detected": True},
    ]
    result = aggregate_verdicts(verdicts, minimum_pass_score=3)
    assert result["classification_pass"] is True
    assert result["hallucination_detected"] is False
    assert result["groundless_rate"] == 0.25


def test_estimate_judge_plan_counts_three_models() -> None:
    judges = {
        "models": ["a", "b", "c"],
        "max_samples_per_classifier": 10,
        "estimated_input_tokens_per_call": 100,
        "estimated_output_tokens_per_call": 50,
    }
    pricing = {
        "models": {model: {"input": 1.0, "output": 2.0} for model in judges["models"]}
    }
    result = estimate_judge_plan(judges, pricing)
    assert result["classifier_predictions"] == 20
    assert result["total_calls"] == 60
    assert result["estimated_total_cost_usd"] > 0


def test_evaluate_prediction_uses_strict_schema_and_usage() -> None:
    captured = {}

    class Responses:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                output_text=json.dumps(
                    {
                        "classification_score": 4,
                        "groundedness_score": 4,
                        "hallucination_detected": False,
                        "unsupported_claims": [],
                        "rationale": "The predicted label matches the explicit behavior.",
                    }
                ),
                usage=SimpleNamespace(input_tokens=100, output_tokens=20),
            )

    client = SimpleNamespace(responses=Responses())
    prediction = {
        "text": "The system shall export a PDF.",
        "reference_label": "FUNCTIONAL",
        "predicted_label": "FUNCTIONAL",
        "confidence": 0.9,
    }
    pricing = {"models": {"judge": {"input": 1.0, "output": 2.0}}}
    result = evaluate_prediction(client, "judge", prediction, pricing)
    schema = captured["text"]["format"]["schema"]
    assert schema["additionalProperties"] is False
    assert sorted(schema["required"]) == sorted(JudgeVerdict.model_fields)
    assert result["input_tokens"] == 100
    assert result["output_tokens"] == 20
