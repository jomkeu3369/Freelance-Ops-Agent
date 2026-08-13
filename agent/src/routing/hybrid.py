"""BM25 + encoder route rankings combined with reciprocal-rank fusion."""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol


class RouteLabel(StrEnum):
    DIRECT_TOOL = "DIRECT_TOOL"
    SIMPLE_LLM = "SIMPLE_LLM"
    REACT_AGENT = "REACT_AGENT"
    SUPERVISOR = "SUPERVISOR"
    HUMAN_REQUIRED = "HUMAN_REQUIRED"


ROUTE_ORDER = tuple(RouteLabel)


@dataclass(frozen=True, slots=True)
class RouteExample:
    example_id: str
    text: str
    route: RouteLabel

    def __post_init__(self) -> None:
        if not self.example_id.strip():
            raise ValueError("route example id must not be empty")
        if not self.text.strip():
            raise ValueError("route example text must not be empty")


@dataclass(frozen=True, slots=True)
class RouteRank:
    route: RouteLabel
    rank: int
    score: float


@dataclass(frozen=True, slots=True)
class RouteDecision:
    """A local decision or an explicit request for the next fallback lane."""

    route: RouteLabel | None
    suggested_route: RouteLabel
    needs_fallback: bool
    fallback_reason: str | None
    fused_share: float
    margin: float
    bm25_ranking: tuple[RouteRank, ...]
    encoder_ranking: tuple[RouteRank, ...]
    fused_ranking: tuple[RouteRank, ...]
    matched_example_ids: tuple[str, ...]


class EncoderRouteScorer(Protocol):
    """Adapter boundary for a local or remote text encoder."""

    @property
    def model_id(self) -> str: ...

    async def score_routes(self, text: str) -> Mapping[RouteLabel, float]: ...


@dataclass(frozen=True, slots=True)
class HybridRouteConfig:
    bm25_top_k: int = 20
    rrf_k: int = 60
    bm25_weight: float = 1.0
    encoder_weight: float = 1.0
    min_fused_share: float = 0.20
    min_margin: float = 0.0
    require_lane_agreement: bool = True

    def __post_init__(self) -> None:
        if self.bm25_top_k < 1:
            raise ValueError("bm25_top_k must be positive")
        if self.rrf_k < 1:
            raise ValueError("rrf_k must be positive")
        if self.bm25_weight <= 0 or self.encoder_weight <= 0:
            raise ValueError("RRF lane weights must be positive")
        if not 0 <= self.min_fused_share <= 1:
            raise ValueError("min_fused_share must be between 0 and 1")
        if not 0 <= self.min_margin <= 1:
            raise ValueError("min_margin must be between 0 and 1")


@dataclass(frozen=True, slots=True)
class _Bm25Result:
    ranking: tuple[RouteRank, ...]
    matched_example_ids: tuple[str, ...]
    has_signal: bool


class _Bm25RouteIndex:
    """Small immutable BM25 index over labelled route examples."""

    def __init__(self, examples: Sequence[RouteExample]) -> None:
        if not examples:
            raise ValueError("at least one route example is required")
        if len({example.example_id for example in examples}) != len(examples):
            raise ValueError("route example ids must be unique")
        missing = set(ROUTE_ORDER) - {example.route for example in examples}
        if missing:
            raise ValueError(f"route examples must cover every label: {sorted(missing)}")

        self._examples = tuple(examples)
        self._documents = tuple(_tokenize(example.text) for example in examples)
        self._document_frequencies = self._count_document_frequencies(self._documents)
        self._average_length = sum(len(document) for document in self._documents) / len(self._documents)

    def rank(self, text: str, *, top_k: int) -> _Bm25Result:
        query_tokens = _tokenize(text)
        if not query_tokens:
            return _Bm25Result(_empty_ranking(), (), False)

        scores = [self._score_document(query_tokens, document) for document in self._documents]
        ranked_documents = sorted(range(len(scores)), key=lambda index: (-scores[index], index))
        positive = [index for index in ranked_documents if scores[index] > 0][:top_k]
        if not positive:
            return _Bm25Result(_empty_ranking(), (), False)

        route_scores = dict.fromkeys(ROUTE_ORDER, 0.0)
        for rank, index in enumerate(positive, start=1):
            route = self._examples[index].route
            route_scores[route] += 1.0 / rank
        ranking = _rank_scores(route_scores)
        return _Bm25Result(
            ranking=ranking,
            matched_example_ids=tuple(self._examples[index].example_id for index in positive),
            has_signal=True,
        )

    def _score_document(self, query_tokens: Sequence[str], document: Sequence[str]) -> float:
        frequencies = Counter(document)
        score = 0.0
        document_count = len(self._documents)
        document_length = len(document)
        for token in set(query_tokens):
            frequency = frequencies[token]
            if frequency == 0:
                continue
            document_frequency = self._document_frequencies[token]
            inverse_document_frequency = math.log(
                1 + (document_count - document_frequency + 0.5) / (document_frequency + 0.5)
            )
            length_normalizer = frequency + 1.5 * (0.25 + 0.75 * document_length / self._average_length)
            score += inverse_document_frequency * frequency * 2.5 / length_normalizer
        return score

    @staticmethod
    def _count_document_frequencies(documents: Sequence[Sequence[str]]) -> Counter[str]:
        frequencies: Counter[str] = Counter()
        for document in documents:
            frequencies.update(set(document))
        return frequencies


class HybridRouteModel:
    """Fuse lexical and semantic route rankings, abstaining on uncertainty."""

    def __init__(
        self,
        examples: Sequence[RouteExample],
        encoder: EncoderRouteScorer,
        *,
        config: HybridRouteConfig | None = None,
    ) -> None:
        self._bm25 = _Bm25RouteIndex(examples)
        self._encoder = encoder
        self._config = config or HybridRouteConfig()

    @property
    def encoder_model_id(self) -> str:
        return self._encoder.model_id

    async def route(self, text: str) -> RouteDecision:
        if not text.strip():
            raise ValueError("route text must not be empty")

        bm25 = self._bm25.rank(text, top_k=self._config.bm25_top_k)
        encoder_scores = self._validate_encoder_scores(await self._encoder.score_routes(text))
        encoder_ranking = _rank_scores(encoder_scores)
        fused_ranking = _reciprocal_rank_fusion(
            bm25.ranking,
            encoder_ranking,
            k=self._config.rrf_k,
            first_weight=self._config.bm25_weight,
            second_weight=self._config.encoder_weight,
        )
        total = sum(item.score for item in fused_ranking)
        first = fused_ranking[0]
        second = fused_ranking[1]
        fused_share = first.score / total
        margin = (first.score - second.score) / total

        reason: str | None = None
        if not bm25.has_signal:
            reason = "NO_BM25_SIGNAL"
        elif self._config.require_lane_agreement and bm25.ranking[0].route != encoder_ranking[0].route:
            reason = "LANE_DISAGREEMENT"
        elif fused_share < self._config.min_fused_share:
            reason = "LOW_FUSED_SHARE"
        elif margin < self._config.min_margin:
            reason = "LOW_ROUTE_MARGIN"

        return RouteDecision(
            route=None if reason else first.route,
            suggested_route=first.route,
            needs_fallback=reason is not None,
            fallback_reason=reason,
            fused_share=fused_share,
            margin=margin,
            bm25_ranking=bm25.ranking,
            encoder_ranking=encoder_ranking,
            fused_ranking=fused_ranking,
            matched_example_ids=bm25.matched_example_ids,
        )

    @staticmethod
    def _validate_encoder_scores(scores: Mapping[RouteLabel, float]) -> dict[RouteLabel, float]:
        if set(scores) != set(ROUTE_ORDER):
            raise ValueError("encoder must score every route exactly once")
        validated = {route: float(scores[route]) for route in ROUTE_ORDER}
        if any(not math.isfinite(score) for score in validated.values()):
            raise ValueError("encoder route scores must be finite")
        return validated


def load_route_examples(path: Path) -> tuple[RouteExample, ...]:
    """Load the versioned routing JSONL without coupling runtime to experiments."""

    examples: list[RouteExample] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            examples.append(
                RouteExample(
                    example_id=str(row["id"]),
                    text=str(row["prompt"]),
                    route=RouteLabel(str(row["expected_route"])),
                )
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ValueError(f"invalid routing example at line {line_number}") from error
    return tuple(examples)


def _tokenize(text: str) -> tuple[str, ...]:
    words = tuple(re.findall(r"[0-9a-zA-Z가-힣]+", text.casefold()))
    character_ngrams = tuple(
        token[index : index + 2]
        for token in words
        if any("가" <= character <= "힣" for character in token)
        for index in range(len(token) - 1)
    )
    return words + character_ngrams


def _empty_ranking() -> tuple[RouteRank, ...]:
    return tuple(RouteRank(route=route, rank=index, score=0.0) for index, route in enumerate(ROUTE_ORDER, start=1))


def _rank_scores(scores: Mapping[RouteLabel, float]) -> tuple[RouteRank, ...]:
    route_position = {route: index for index, route in enumerate(ROUTE_ORDER)}
    ordered = sorted(ROUTE_ORDER, key=lambda route: (-scores[route], route_position[route]))
    return tuple(RouteRank(route=route, rank=rank, score=scores[route]) for rank, route in enumerate(ordered, start=1))


def _reciprocal_rank_fusion(
    first: Sequence[RouteRank],
    second: Sequence[RouteRank],
    *,
    k: int,
    first_weight: float,
    second_weight: float,
) -> tuple[RouteRank, ...]:
    first_ranks = {item.route: item.rank for item in first}
    second_ranks = {item.route: item.rank for item in second}
    fused = {
        route: first_weight / (k + first_ranks[route]) + second_weight / (k + second_ranks[route])
        for route in ROUTE_ORDER
    }
    return _rank_scores(fused)
