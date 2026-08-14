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
    output_format = responses.calls[0]["text"]["format"]
    schema = output_format["schema"]
    assert schema["required"] == ["summary", "open_questions"]
    assert schema["additionalProperties"] is False


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
async def test_openai_react_step_uses_separate_strict_tool_decision_schema() -> None:
    class ReActResponses(FakeOpenAIResponses):
        async def create(self, **kwargs: object) -> object:
            self.calls.append(kwargs)
            return SimpleNamespace(
                output_text=json.dumps(
                    {"action": "TOOL", "tool_name": "get_project_context", "arguments": {}}
                ),
                usage=SimpleNamespace(input_tokens=9, output_tokens=4),
            )

    responses = ReActResponses()
    provider = OpenAIModelProvider(SimpleNamespace(responses=responses))

    generation = await provider.generate_react_step(
        ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        "bounded step",
        max_output_tokens=100,
    )

    assert generation.payload["action"] == "TOOL"
    text = responses.calls[0]["text"]
    assert isinstance(text, dict)
    output_format = text["format"]
    assert isinstance(output_format, dict)
    assert output_format["name"] == "bounded_react_step"
    assert output_format["strict"] is True
    schema = output_format["schema"]
    assert schema["required"] == ["action", "tool_name", "arguments", "summary", "open_questions"]
    arguments_schema = schema["$defs"]["ReActArguments"]
    assert arguments_schema["required"] == ["query"]
    assert arguments_schema["additionalProperties"] is False
    assert "default" not in arguments_schema["properties"]["query"]


@pytest.mark.asyncio
async def test_gemini_react_step_uses_same_provider_neutral_contract() -> None:
    class ReActModels(FakeGeminiModels):
        async def generate_content(self, **kwargs: object) -> object:
            self.calls.append(kwargs)
            return SimpleNamespace(
                text=json.dumps({"action": "FINAL", "summary": "완료", "arguments": {}}),
                usage_metadata=SimpleNamespace(prompt_token_count=8, candidates_token_count=3),
            )

    models = ReActModels()
    provider = GeminiModelProvider(SimpleNamespace(models=models))

    generation = await provider.generate_react_step(
        ModelSelection(provider=Provider.GEMINI, model="gemini-test"),
        "bounded step",
        max_output_tokens=100,
    )

    assert generation.payload["action"] == "FINAL"
    config = models.calls[0]["config"]
    assert isinstance(config, dict)
    assert config["response_json_schema"]["title"] == "ReActStep"


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
