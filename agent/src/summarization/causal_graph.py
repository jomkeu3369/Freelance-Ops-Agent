from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from math import sqrt
from typing import Protocol

Embedding = tuple[float, ...]

class CausalRelationType(StrEnum):
    CAUSES = "CAUSES"
    LIKELY_CAUSES = "LIKELY_CAUSES"
    ENABLES = "ENABLES"
    PREVENTS = "PREVENTS"
    TEMPORAL_BEFORE = "TEMPORAL_BEFORE"
    CORRELATED = "CORRELATED"
    UNRELATED = "UNRELATED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"

class CandidateReason(StrEnum):
    LOCAL_WINDOW = "LOCAL_WINDOW"
    SEMANTIC_NEIGHBOR = "SEMANTIC_NEIGHBOR"
    SHARED_ENTITY = "SHARED_ENTITY"

CAUSAL_RELATION_TYPES = frozenset(
    {
        CausalRelationType.CAUSES,
        CausalRelationType.LIKELY_CAUSES,
        CausalRelationType.ENABLES,
        CausalRelationType.PREVENTS
    }
)

@dataclass(frozen=True, slots=True)
class TextChunk:
    chunk_id: str
    order: int
    text: str

    def __post_init__(self) -> None:
        if not self.chunk_id.strip() or not self.text.strip():
            raise ValueError("chunk id and text must not be empty")

        if self.order < 0:
            raise ValueError("chunk order must not be negative")

@dataclass(frozen=True, slots=True)
class Event:
    event_id: str
    chunk_id: str
    chunk_order: int
    event_order: int
    text: str
    embedding: Embedding
    entities: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if not self.event_id.strip() or not self.chunk_id.strip() or not self.text.strip():
            raise ValueError("event id, chunk id and text must not be empty")
        if self.chunk_order < 0 or self.event_order < 0:
            raise ValueError("event positions must not be negative")
        if not self.embedding:
            raise ValueError("event embedding must not be empty")

    @property
    def position(self) -> tuple[int, int, str]:
        return self.chunk_order, self.event_order, self.event_id

@dataclass(frozen=True, slots=True)
class CausalRelation:
    source_event_id: str
    target_event_id: str
    relation_type: CausalRelationType
    confidence: float
    evidence: str
    evidence_chunk_ids: tuple[str, ...]
    direct: bool = True

    def __post_init__(self) -> None:
        if self.source_event_id == self.target_event_id:
            raise ValueError("a relation must connect different events")
        if not 0 <= self.confidence <= 1:
            raise ValueError("relation confidence must be between 0 and 1")

    @property
    def pair(self) -> tuple[str, str]:
        return self.source_event_id, self.target_event_id

    @property
    def is_causal(self) -> bool:
        return self.relation_type in CAUSAL_RELATION_TYPES

@dataclass(frozen=True, slots=True)
class ChunkAnalysis:
    chunk_id: str
    events: tuple[Event, ...]
    local_relations: tuple[CausalRelation, ...] = ()

@dataclass(frozen=True, slots=True)
class CausalCandidate:
    source_event_id: str
    target_event_id: str
    reasons: frozenset[CandidateReason]
    similarity: float

    @property
    def pair(self) -> tuple[str, str]:
        return self.source_event_id, self.target_event_id

@dataclass(frozen=True, slots=True)
class CausalGraph:
    events: tuple[Event, ...]
    relations: tuple[CausalRelation, ...]
    evaluated_candidates: tuple[CausalCandidate, ...]

    @property
    def causal_relations(self) -> tuple[CausalRelation, ...]:
        return tuple(relation for relation in self.relations if relation.is_causal)

@dataclass(frozen=True, slots=True)
class CausalGraphConfig:
    local_chunk_window: int = 1
    max_semantic_neighbors: int = 3
    semantic_similarity_threshold: float = 0.75
    relation_confidence_threshold: float = 0.65
    classification_batch_size: int = 16
    analysis_concurrency: int = 8

    def __post_init__(self) -> None:
        if self.local_chunk_window < 0 or self.max_semantic_neighbors < 0:
            raise ValueError("candidate limits must not be negative")
        if not 0 <= self.semantic_similarity_threshold <= 1:
            raise ValueError("semantic similarity threshold must be between 0 and 1")
        if not 0 <= self.relation_confidence_threshold <= 1:
            raise ValueError("relation confidence threshold must be between 0 and 1")
        if self.classification_batch_size < 1 or self.analysis_concurrency < 1:
            raise ValueError("batch size and concurrency must be positive")

class ChunkAnalysisProvider(Protocol):
    async def analyze(self, chunk: TextChunk) -> ChunkAnalysis: ...

class RelationClassifier(Protocol):
    async def classify(
        self, candidates: Sequence[CausalCandidate], events: Mapping[str, Event]
    ) -> Sequence[CausalRelation]: ...

class SemanticNeighborProvider(Protocol):
    def neighbors(self, events: Sequence[Event], limit: int) -> Mapping[str, Sequence[str]]: ...

class InMemoryCosineNeighborProvider:
    """Exact neighbor search intended for small documents and deterministic tests."""

    def neighbors(self, events: Sequence[Event], limit: int) -> Mapping[str, Sequence[str]]:
        if limit <= 0:
            return {event.event_id: () for event in events}
        return {
            event.event_id: tuple(
                candidate.event_id
                for candidate in sorted(
                    (candidate for candidate in events if candidate.event_id != event.event_id),
                    key=lambda candidate: (-_cosine(event.embedding, candidate.embedding), candidate.position)
                )[:limit]
            )
            for event in events
        }

class CausalCandidateGenerator:
    def __init__(self, neighbor_provider: SemanticNeighborProvider, config: CausalGraphConfig) -> None:
        self._neighbor_provider = neighbor_provider
        self._config = config

    def generate(self, events: Sequence[Event]) -> tuple[CausalCandidate, ...]:
        by_id = {event.event_id: event for event in events}
        reasons_by_pair: dict[tuple[str, str], set[CandidateReason]] = {}

        for index, left in enumerate(events):
            for right in events[index + 1:]:
                source, target = _ordered_pair(left, right)
                if target.chunk_order - source.chunk_order <= self._config.local_chunk_window:
                    reasons_by_pair.setdefault((source.event_id, target.event_id), set()).add(
                        CandidateReason.LOCAL_WINDOW
                    )

        neighbors = self._neighbor_provider.neighbors(events, self._config.max_semantic_neighbors)
        for event in events:
            for neighbor_id in neighbors.get(event.event_id, ()):
                neighbor = by_id[neighbor_id]
                similarity = _cosine(event.embedding, neighbor.embedding)
                if similarity < self._config.semantic_similarity_threshold:
                    continue
                source, target = _ordered_pair(event, neighbor)
                reasons = reasons_by_pair.setdefault((source.event_id, target.event_id), set())
                reasons.add(CandidateReason.SEMANTIC_NEIGHBOR)
                if source.entities.intersection(target.entities):
                    reasons.add(CandidateReason.SHARED_ENTITY)

        return tuple(
            CausalCandidate(
                source_event_id=source_id,
                target_event_id=target_id,
                reasons=frozenset(reasons),
                similarity=_cosine(by_id[source_id].embedding, by_id[target_id].embedding)
            )
            for (source_id, target_id), reasons in sorted(reasons_by_pair.items())
        )

class CausalGraphBuilder:
    def __init__(
        self,
        analyzer: ChunkAnalysisProvider,
        classifier: RelationClassifier,
        *,
        config: CausalGraphConfig | None = None,
        neighbor_provider: SemanticNeighborProvider | None = None
    ) -> None:
        self._analyzer = analyzer
        self._classifier = classifier
        self._config = config or CausalGraphConfig()
        self._candidate_generator = CausalCandidateGenerator(
            neighbor_provider or InMemoryCosineNeighborProvider(), self._config
        )

    async def build(self, chunks: Sequence[TextChunk]) -> CausalGraph:
        ordered_chunks = self._validate_chunks(chunks)
        analyses = await self._analyze_chunks(ordered_chunks)
        events, local_relations = self._validate_analyses(ordered_chunks, analyses)
        events_by_id = {event.event_id: event for event in events}
        local_pairs = {relation.pair for relation in local_relations}
        candidates = tuple(
            candidate for candidate in self._candidate_generator.generate(events) if candidate.pair not in local_pairs
        )
        classified = await self._classify_candidates(candidates, events_by_id)
        relations = self._accepted_relations((*local_relations, *classified), events_by_id)
        return CausalGraph(events=events, relations=relations, evaluated_candidates=candidates)

    @staticmethod
    def _validate_chunks(chunks: Sequence[TextChunk]) -> tuple[TextChunk, ...]:
        if not chunks:
            raise ValueError("at least one chunk is required")
        if len({chunk.chunk_id for chunk in chunks}) != len(chunks):
            raise ValueError("chunk ids must be unique")
        if len({chunk.order for chunk in chunks}) != len(chunks):
            raise ValueError("chunk orders must be unique")
        return tuple(sorted(chunks, key=lambda chunk: chunk.order))

    async def _analyze_chunks(self, chunks: Sequence[TextChunk]) -> tuple[ChunkAnalysis, ...]:
        semaphore = asyncio.Semaphore(self._config.analysis_concurrency)

        async def analyze(chunk: TextChunk) -> ChunkAnalysis:
            async with semaphore:
                return await self._analyzer.analyze(chunk)

        return tuple(await asyncio.gather(*(analyze(chunk) for chunk in chunks)))

    @staticmethod
    def _validate_analyses(
        chunks: Sequence[TextChunk], analyses: Sequence[ChunkAnalysis]
    ) -> tuple[tuple[Event, ...], tuple[CausalRelation, ...]]:
        chunks_by_id = {chunk.chunk_id: chunk for chunk in chunks}
        if {analysis.chunk_id for analysis in analyses} != set(chunks_by_id):
            raise ValueError("analysis results must match requested chunks")

        events = tuple(event for analysis in analyses for event in analysis.events)
        if len({event.event_id for event in events}) != len(events):
            raise ValueError("event ids must be unique")
        for event in events:
            chunk = chunks_by_id.get(event.chunk_id)
            if chunk is None or chunk.order != event.chunk_order:
                raise ValueError("events must preserve source chunk provenance")

        event_ids = {event.event_id for event in events}
        local_relations = tuple(relation for analysis in analyses for relation in analysis.local_relations)
        if any(set(relation.pair) - event_ids for relation in local_relations):
            raise ValueError("local relations must reference extracted events")
        return tuple(sorted(events, key=lambda event: event.position)), local_relations

    async def _classify_candidates(
        self, candidates: Sequence[CausalCandidate], events: Mapping[str, Event]
    ) -> tuple[CausalRelation, ...]:
        relations: list[CausalRelation] = []
        for offset in range(0, len(candidates), self._config.classification_batch_size):
            batch = candidates[offset:offset + self._config.classification_batch_size]
            batch_pairs = {candidate.pair for candidate in batch}
            classified = await self._classifier.classify(batch, events)
            if any(relation.pair not in batch_pairs for relation in classified):
                raise ValueError("classifier returned a relation outside the candidate batch")
            relations.extend(classified)
        return tuple(relations)

    def _accepted_relations(
        self, relations: Sequence[CausalRelation], events: Mapping[str, Event]
    ) -> tuple[CausalRelation, ...]:
        accepted: dict[tuple[str, str], CausalRelation] = {}
        discarded = {CausalRelationType.UNRELATED, CausalRelationType.INSUFFICIENT_EVIDENCE}
        for relation in relations:
            if set(relation.pair) - events.keys():
                raise ValueError("relations must reference extracted events")
            if relation.relation_type in discarded or relation.confidence < self._config.relation_confidence_threshold:
                continue
            if relation.is_causal and (not relation.evidence.strip() or not relation.evidence_chunk_ids):
                continue
            previous = accepted.get(relation.pair)
            if previous is None or relation.confidence > previous.confidence:
                accepted[relation.pair] = relation
        return tuple(accepted[pair] for pair in sorted(accepted))

def _ordered_pair(left: Event, right: Event) -> tuple[Event, Event]:
    return (left, right) if left.position < right.position else (right, left)

def _cosine(left: Embedding, right: Embedding) -> float:
    if len(left) != len(right):
        raise ValueError("event embedding dimensions must match")
    left_norm = sqrt(sum(value * value for value in left))
    right_norm = sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return sum(left_value * right_value for left_value, right_value in zip(left, right, strict=True)) / (
        left_norm * right_norm
    )
