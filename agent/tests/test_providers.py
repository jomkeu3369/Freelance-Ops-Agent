from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from contracts import ModelSelection, Provider
from providers import CompositeModelProvider, GeminiModelProvider, OpenAIModelProvider, ProviderCallError


class FakeOpenAIResponses:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return SimpleNamespace(
            output_text=json.dumps({"summary": "OpenAI 결과", "open_questions": []}),
            usage=SimpleNamespace(input_tokens=11, output_tokens=7),
        )


class FakeGeminiModels:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def generate_content(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return SimpleNamespace(
            text=json.dumps({"summary": "Gemini 결과", "open_questions": ["확인할까요?"]}),
            usage_metadata=SimpleNamespace(prompt_token_count=13, candidates_token_count=5),
        )


@pytest.mark.asyncio
async def test_composite_dispatches_openai_with_strict_non_stored_output() -> None:
    responses = FakeOpenAIResponses()
    openai = OpenAIModelProvider(SimpleNamespace(responses=responses))
    gemini = GeminiModelProvider(SimpleNamespace(models=FakeGeminiModels()))
    provider = CompositeModelProvider(openai, gemini)

    generation = await provider.generate_structured(
        ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        "untrusted request",
        max_output_tokens=100,
    )

    assert generation.payload["summary"] == "OpenAI 결과"
    assert generation.input_tokens == 11
    assert responses.calls[0]["store"] is False
    assert responses.calls[0]["tools"] == []


@pytest.mark.asyncio
async def test_composite_dispatches_gemini_with_same_schema() -> None:
    models = FakeGeminiModels()
    provider = CompositeModelProvider(
        OpenAIModelProvider(SimpleNamespace(responses=FakeOpenAIResponses())),
        GeminiModelProvider(SimpleNamespace(models=models)),
    )

    generation = await provider.generate_structured(
        ModelSelection(provider=Provider.GEMINI, model="gemini-test"),
        "untrusted request",
        max_output_tokens=100,
    )

    assert generation.payload["summary"] == "Gemini 결과"
    assert generation.output_tokens == 5
    config = models.calls[0]["config"]
    assert isinstance(config, dict)
    assert config["response_mime_type"] == "application/json"


@pytest.mark.asyncio
async def test_provider_retries_transient_failure_but_redacts_error() -> None:
    class TransientError(Exception):
        status_code = 503

    class FailingResponses:
        def __init__(self) -> None:
            self.calls = 0

        async def create(self, **kwargs: object) -> object:
            del kwargs
            self.calls += 1
            raise TransientError("secret request body")

    responses = FailingResponses()
    provider = OpenAIModelProvider(SimpleNamespace(responses=responses), max_attempts=2)

    with pytest.raises(ProviderCallError, match="model provider call failed") as caught:
        await provider.generate_structured(
            ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
            "sensitive input",
            max_output_tokens=10,
        )

    assert responses.calls == 2
    assert "sensitive input" not in str(caught.value)


@pytest.mark.asyncio
async def test_successful_retry_reports_every_model_call() -> None:
    class TransientError(Exception):
        status_code = 503

    class RetryResponses:
        calls = 0

        async def create(self, **kwargs: object) -> object:
            del kwargs
            self.calls += 1
            if self.calls == 1:
                raise TransientError()
            return SimpleNamespace(
                output_text=json.dumps({"summary": "retried", "open_questions": []}),
                usage=SimpleNamespace(input_tokens=3, output_tokens=2),
            )

    responses = RetryResponses()
    provider = OpenAIModelProvider(SimpleNamespace(responses=responses), max_attempts=2)
    generation = await provider.generate_structured(
        ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        "request",
        max_output_tokens=10,
    )

    assert generation.model_calls == 2
