from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from contracts import ModelSelection, Provider
from providers import CompositeModelProvider, OpenAIModelProvider, ProviderCallError, ProviderNotConfiguredError


class FakeOpenAIResponses:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return SimpleNamespace(
            output_text=json.dumps({"summary": "OpenAI 결과", "open_questions": []}),
            usage=SimpleNamespace(input_tokens=11, output_tokens=7),
        )


@pytest.mark.asyncio
async def test_composite_dispatches_openai_with_strict_non_stored_output() -> None:
    responses = FakeOpenAIResponses()
    openai = OpenAIModelProvider(SimpleNamespace(responses=responses))
    provider = CompositeModelProvider(openai)

    generation = await provider.generate_structured(
        ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        "untrusted request",
        max_output_tokens=100,
    )

    assert generation.payload["summary"] == "OpenAI 결과"
    assert generation.input_tokens == 11
    assert responses.calls[0]["store"] is False
    assert responses.calls[0]["tools"] == []
    assert responses.calls[0]["text"]["verbosity"] == "low"
    output_format = responses.calls[0]["text"]["format"]
    schema = output_format["schema"]
    assert schema["required"] == ["summary", "open_questions", "quotation_drafts"]
    assert schema["additionalProperties"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method", ["generate_structured", "generate_react_step", "generate_pet", "generate_assumption"]
)
async def test_retired_provider_is_rejected_without_openai_fallback(method: str) -> None:
    responses = FakeOpenAIResponses()
    provider = CompositeModelProvider(OpenAIModelProvider(SimpleNamespace(responses=responses)))
    with pytest.raises(ProviderNotConfiguredError, match="Unsupported AI provider"):
        await getattr(provider, method)(
            ModelSelection(provider=Provider.GEMINI, model="gemini-test"), "test", max_output_tokens=100
        )
    assert responses.calls == []


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
    assert schema["required"] == [
        "action",
        "tool_name",
        "arguments",
        "summary",
        "open_questions",
        "quotation_drafts"
    ]
    arguments_schema = schema["$defs"]["ReActArguments"]
    assert arguments_schema["required"] == ["query"]
    assert arguments_schema["additionalProperties"] is False
    assert "default" not in arguments_schema["properties"]["query"]


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


@pytest.mark.asyncio
async def test_openai_incomplete_output_is_rejected_before_json_parsing() -> None:
    class IncompleteResponses:
        async def create(self, **kwargs: object) -> object:
            del kwargs
            return SimpleNamespace(
                status="incomplete",
                incomplete_details=SimpleNamespace(reason="max_output_tokens"),
                output_text='{"action":"FINAL","summary":"truncated',
                usage=SimpleNamespace(input_tokens=10, output_tokens=100)
            )

    provider = OpenAIModelProvider(SimpleNamespace(responses=IncompleteResponses()))

    with pytest.raises(ProviderCallError, match="incomplete output") as caught:
        await provider.generate_react_step(
            ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
            "bounded step",
            max_output_tokens=100
        )

    assert "truncated" not in str(caught.value)
    assert caught.value.model_calls == 1
    assert caught.value.input_tokens == 10
    assert caught.value.output_tokens == 100


@pytest.mark.asyncio
async def test_openai_malformed_output_is_sanitized() -> None:
    class MalformedResponses:
        def __init__(self) -> None:
            self.calls = 0

        async def create(self, **kwargs: object) -> object:
            del kwargs
            self.calls += 1
            return SimpleNamespace(
                status="completed",
                output_text='{"action":"FINAL","summary":"malformed',
                usage=SimpleNamespace(input_tokens=10, output_tokens=10)
            )

    responses = MalformedResponses()
    provider = OpenAIModelProvider(SimpleNamespace(responses=responses))

    with pytest.raises(ProviderCallError, match="invalid structured output") as caught:
        await provider.generate_react_step(
            ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
            "bounded step",
            max_output_tokens=100
        )

    assert "malformed" not in str(caught.value)
    assert responses.calls == 2
    assert caught.value.model_calls == 2
    assert caught.value.input_tokens == 20
    assert caught.value.output_tokens == 20


@pytest.mark.asyncio
async def test_openai_invalid_structured_output_is_regenerated_once() -> None:
    class RegeneratedResponses:
        def __init__(self) -> None:
            self.calls = 0

        async def create(self, **kwargs: object) -> object:
            del kwargs
            self.calls += 1
            if self.calls == 1:
                output_text = '{"action":"FINAL","summary":"malformed'
            else:
                output_text = json.dumps(
                    {
                        "action": "FINAL",
                        "tool_name": None,
                        "arguments": {"query": None},
                        "summary": "재생성 완료",
                        "open_questions": [],
                        "quotation_drafts": []
                    }
                )
            return SimpleNamespace(
                status="completed",
                output_text=output_text,
                usage=SimpleNamespace(input_tokens=10, output_tokens=5)
            )

    responses = RegeneratedResponses()
    provider = OpenAIModelProvider(SimpleNamespace(responses=responses))

    generation = await provider.generate_react_step(
        ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        "bounded step",
        max_output_tokens=100
    )

    assert generation.payload["summary"] == "재생성 완료"
    assert generation.model_calls == 2
    assert generation.input_tokens == 20
    assert generation.output_tokens == 10
    assert responses.calls == 2


def test_selection_schema_advertises_only_supported_provider_but_decodes_history() -> None:
    assert ModelSelection.model_json_schema()["properties"]["provider"]["enum"] == ["OPENAI"]
    historical = ModelSelection.model_validate({"provider": "GEMINI", "model": "retired"})
    assert historical.provider is Provider.GEMINI
    assert not historical.provider.supported
