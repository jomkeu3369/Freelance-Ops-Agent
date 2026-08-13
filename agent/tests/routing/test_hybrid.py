from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path

import pytest

from routing import (
    HybridRouteConfig,
    HybridRouteModel,
    RouteExample,
    RouteLabel,
    load_route_examples,
)


class FixedEncoder:
    model_id = "test-encoder-v1"

    def __init__(self, top_route: RouteLabel) -> None:
        self._top_route = top_route

    async def score_routes(self, text: str) -> Mapping[RouteLabel, float]:
        del text
        return {route: 1.0 if route is self._top_route else 0.1 for route in RouteLabel}


def examples() -> tuple[RouteExample, ...]:
    return (
        RouteExample("direct-1", "확정된 금액의 부가세와 합계를 계산", RouteLabel.DIRECT_TOOL),
        RouteExample("simple-1", "문장을 자연스럽게 요약하고 다듬기", RouteLabel.SIMPLE_LLM),
        RouteExample("react-1", "웹 검색 도구로 자료를 찾아 검증하기", RouteLabel.REACT_AGENT),
        RouteExample("supervisor-1", "법무 개발 재무 부서 결과를 통합", RouteLabel.SUPERVISOR),
        RouteExample("human-1", "민감한 개인정보 외부 전송을 승인", RouteLabel.HUMAN_REQUIRED),
    )


@pytest.mark.asyncio
async def test_accepts_when_bm25_and_encoder_agree() -> None:
    model = HybridRouteModel(examples(), FixedEncoder(RouteLabel.DIRECT_TOOL))

    decision = await model.route("확정 금액의 부가세 합계를 계산해줘")

    assert decision.route is RouteLabel.DIRECT_TOOL
    assert not decision.needs_fallback
    assert decision.bm25_ranking[0].route is RouteLabel.DIRECT_TOOL
    assert decision.encoder_ranking[0].route is RouteLabel.DIRECT_TOOL
    assert decision.fused_ranking[0].route is RouteLabel.DIRECT_TOOL
    assert decision.matched_example_ids[0] == "direct-1"
    assert model.encoder_model_id == "test-encoder-v1"


@pytest.mark.asyncio
async def test_abstains_when_lanes_disagree() -> None:
    model = HybridRouteModel(examples(), FixedEncoder(RouteLabel.SUPERVISOR))

    decision = await model.route("확정 금액의 부가세 합계를 계산해줘")

    assert decision.route is None
    assert decision.needs_fallback
    assert decision.fallback_reason == "LANE_DISAGREEMENT"
    assert decision.suggested_route in {RouteLabel.DIRECT_TOOL, RouteLabel.SUPERVISOR}


@pytest.mark.asyncio
async def test_abstains_without_a_lexical_signal() -> None:
    model = HybridRouteModel(examples(), FixedEncoder(RouteLabel.REACT_AGENT))

    decision = await model.route("완전히새로운표현xyz")

    assert decision.route is None
    assert decision.fallback_reason == "NO_BM25_SIGNAL"
    assert decision.matched_example_ids == ()


@pytest.mark.asyncio
async def test_can_apply_a_calibrated_margin_threshold() -> None:
    model = HybridRouteModel(
        examples(),
        FixedEncoder(RouteLabel.DIRECT_TOOL),
        config=HybridRouteConfig(min_margin=0.5),
    )

    decision = await model.route("확정 금액의 부가세 합계를 계산해줘")

    assert decision.route is None
    assert decision.fallback_reason == "LOW_ROUTE_MARGIN"


@pytest.mark.asyncio
async def test_rejects_incomplete_encoder_output() -> None:
    class BrokenEncoder:
        model_id = "broken"

        async def score_routes(self, text: str) -> Mapping[RouteLabel, float]:
            del text
            return {RouteLabel.SIMPLE_LLM: 1.0}

    model = HybridRouteModel(examples(), BrokenEncoder())

    with pytest.raises(ValueError, match="every route"):
        await model.route("문장을 요약해줘")


def test_examples_must_cover_every_route() -> None:
    with pytest.raises(ValueError, match="cover every label"):
        HybridRouteModel(examples()[:-1], FixedEncoder(RouteLabel.SIMPLE_LLM))


def test_loads_versioned_jsonl_examples(tmp_path: Path) -> None:
    path = tmp_path / "routes.jsonl"
    rows = [
        {"id": f"case-{index}", "prompt": f"prompt {index}", "expected_route": route.value}
        for index, route in enumerate(RouteLabel)
    ]
    path.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")

    loaded = load_route_examples(path)

    assert len(loaded) == 5
    assert loaded[-1].route is RouteLabel.HUMAN_REQUIRED
