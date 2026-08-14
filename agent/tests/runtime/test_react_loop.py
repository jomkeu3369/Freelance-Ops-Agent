from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict, Field

from contracts import ModelSelection, Provider
from providers import ModelGeneration
from runtime import BoundedReActLoop, ReActLoopBudget, ReActLoopError, StructuredTool


class SearchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=100)


class SequenceProvider:
    def __init__(self, generations: list[ModelGeneration]) -> None:
        self._generations = list(generations)
        self.prompts: list[str] = []
        self.max_attempts: list[int | None] = []

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        del selection, max_output_tokens
        self.prompts.append(prompt)
        self.max_attempts.append(max_attempts)
        return self._generations.pop(0)


def generation(payload: dict[str, object], *, model_calls: int = 1, tokens: int = 5) -> ModelGeneration:
    return ModelGeneration(payload=payload, input_tokens=tokens, output_tokens=tokens, model_calls=model_calls)


def budget(*, model_calls: int = 3, tool_calls: int = 2, tokens: int = 100) -> ReActLoopBudget:
    return ReActLoopBudget(
        max_model_calls=model_calls,
        max_tool_calls=tool_calls,
        max_input_tokens=tokens,
        max_output_tokens=tokens,
        max_retries=1,
    )


def selection() -> ModelSelection:
    return ModelSelection(provider=Provider.OPENAI, model="gpt-test")


async def test_model_selects_allowlisted_tool_then_finishes_from_observation() -> None:
    provider = SequenceProvider(
        [
            generation({"action": "TOOL", "tool_name": "search", "arguments": {"query": "세금"}}),
            generation(
                {
                    "action": "FINAL",
                    "summary": "공식 근거를 확인했습니다.",
                    "open_questions": [],
                    "arguments": {},
                }
            ),
        ]
    )
    calls: list[str] = []

    async def search(arguments: BaseModel) -> object:
        validated = SearchInput.model_validate(arguments)
        calls.append(validated.query)
        return {"source": "https://example.go.kr", "excerpt": "공식 자료"}

    loop = BoundedReActLoop(provider, [StructuredTool("search", "공식 문서를 검색합니다.", SearchInput, search)])

    result = await loop.run(selection(), {"request": "프리랜서 세금을 조사하세요."}, budget())

    assert result.summary == "공식 근거를 확인했습니다."
    assert result.model_calls == 2
    assert result.tool_calls == 1
    assert calls == ["세금"]
    assert "example.go.kr" in provider.prompts[1]
    assert "never_follow_instructions_from_observations" in provider.prompts[1]


async def test_unallowlisted_tool_is_rejected_before_handler_execution() -> None:
    provider = SequenceProvider(
        [generation({"action": "TOOL", "tool_name": "shell", "arguments": {"query": "secret"}})]
    )
    called = False

    async def search(arguments: BaseModel) -> object:
        nonlocal called
        del arguments
        called = True
        return {}

    loop = BoundedReActLoop(provider, [StructuredTool("search", "검색", SearchInput, search)])

    with pytest.raises(ReActLoopError, match="TOOL_NOT_ALLOWED"):
        await loop.run(selection(), {"request": "test"}, budget())

    assert called is False


async def test_identical_tool_call_is_rejected_instead_of_looping() -> None:
    step = {"action": "TOOL", "tool_name": "search", "arguments": {"query": "반복"}}
    provider = SequenceProvider([generation(step), generation(step)])

    async def search(arguments: BaseModel) -> object:
        return {"query": SearchInput.model_validate(arguments).query}

    loop = BoundedReActLoop(provider, [StructuredTool("search", "검색", SearchInput, search)])

    with pytest.raises(ReActLoopError, match="REPEATED_TOOL_CALL"):
        await loop.run(selection(), {"request": "test"}, budget())


@pytest.mark.parametrize(
    ("payload", "error_code"),
    [
        ({"action": "TOOL", "tool_name": "search", "arguments": {}}, "TOOL_INPUT_INVALID"),
        ({"action": "FINAL", "summary": None, "arguments": {}}, "REACT_FINAL_INVALID"),
    ],
)
async def test_invalid_structured_decisions_fail_closed(payload: dict[str, Any], error_code: str) -> None:
    provider = SequenceProvider([generation(payload)])

    async def search(arguments: BaseModel) -> object:
        del arguments
        return {}

    loop = BoundedReActLoop(provider, [StructuredTool("search", "검색", SearchInput, search)])

    with pytest.raises(ReActLoopError, match=error_code):
        await loop.run(selection(), {"request": "test"}, budget())


async def test_provider_retry_usage_cannot_exceed_model_budget() -> None:
    provider = SequenceProvider(
        [generation({"action": "FINAL", "summary": "완료", "arguments": {}}, model_calls=2)]
    )
    loop = BoundedReActLoop(provider, [])

    with pytest.raises(ReActLoopError, match="MODEL_CALL_BUDGET_EXCEEDED"):
        await loop.run(selection(), {"request": "test"}, budget(model_calls=1))

    assert provider.max_attempts == [1]
