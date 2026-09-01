from __future__ import annotations

from collections.abc import Mapping, Sequence

import pytest

import summarization as causal_summary


def make_event(
    event_id: str,
    chunk_id: str,
    chunk_order: int,
    text: str,
    embedding: tuple[float, ...],
    entities: frozenset[str] = frozenset()
) -> causal_summary.Event:
    return causal_summary.Event(event_id, chunk_id, chunk_order, 0, text, embedding, entities)


class RecordingAnalyzer:
    def __init__(self, analyses: Mapping[str, causal_summary.ChunkAnalysis]) -> None:
        self._analyses = analyses
        self.calls: list[str] = []

    async def analyze(self, chunk: causal_summary.TextChunk) -> causal_summary.ChunkAnalysis:
        self.calls.append(chunk.chunk_id)
        return self._analyses[chunk.chunk_id]


class RecordingClassifier:
    def __init__(self, relations: Mapping[tuple[str, str], causal_summary.CausalRelation]) -> None:
        self._relations = relations
        self.calls: list[tuple[tuple[str, str], ...]] = []

    async def classify(
        self, candidates: Sequence[causal_summary.CausalCandidate], events: Mapping[str, causal_summary.Event]
    ) -> Sequence[causal_summary.CausalRelation]:
        del events
        pairs = tuple(candidate.pair for candidate in candidates)
        self.calls.append(pairs)
        return [self._relations[pair] for pair in pairs if pair in self._relations]


@pytest.mark.asyncio
async def test_builds_sparse_causal_graph_with_one_analysis_call_per_chunk() -> None:
    chunks = [
        causal_summary.TextChunk("c1", 0, "정부가 기준금리를 인상했다."),
        causal_summary.TextChunk("c2", 1, "기업의 대출 비용이 증가했다."),
        causal_summary.TextChunk("c3", 2, "기업은 신규 투자를 연기했다."),
        causal_summary.TextChunk("c4", 3, "다음 날 남부 지역에 비가 내렸다.")
    ]
    events = [
        make_event("e1", "c1", 0, "기준금리 인상", (1.0, 0.0), frozenset({"기업금융"})),
        make_event("e2", "c2", 1, "대출 비용 증가", (0.98, 0.02), frozenset({"기업금융"})),
        make_event("e3", "c3", 2, "신규 투자 연기", (0.93, 0.07), frozenset({"기업", "기업금융"})),
        make_event("e4", "c4", 3, "남부 지역 강우", (0.0, 1.0), frozenset({"남부 지역"}))
    ]
    analyzer = RecordingAnalyzer(
        {
            chunk.chunk_id: causal_summary.ChunkAnalysis(chunk.chunk_id, (event,))
            for chunk, event in zip(chunks, events, strict=True)
        }
    )
    classifier = RecordingClassifier(
        {
            ("e1", "e2"): causal_summary.CausalRelation(
                "e1", "e2", causal_summary.CausalRelationType.CAUSES, 0.95,
                "금리 인상으로 대출 비용이 증가했다.", ("c1", "c2")
            ),
            ("e2", "e3"): causal_summary.CausalRelation(
                "e2", "e3", causal_summary.CausalRelationType.LIKELY_CAUSES, 0.82,
                "높아진 대출 비용 때문에 신규 투자를 연기했다.", ("c2", "c3")
            ),
            ("e3", "e4"): causal_summary.CausalRelation(
                "e3", "e4", causal_summary.CausalRelationType.TEMPORAL_BEFORE, 0.98, "다음 날", ("c3", "c4")
            )
        }
    )
    builder = causal_summary.CausalGraphBuilder(
        analyzer,
        classifier,
        config=causal_summary.CausalGraphConfig(
            local_chunk_window=1,
            max_semantic_neighbors=1,
            semantic_similarity_threshold=0.90,
            classification_batch_size=2
        )
    )

    graph = await builder.build(chunks)

    assert sorted(analyzer.calls) == ["c1", "c2", "c3", "c4"]
    assert len(classifier.calls) == 2
    assert len(graph.evaluated_candidates) == 3
    assert {relation.pair for relation in graph.causal_relations} == {("e1", "e2"), ("e2", "e3")}
    assert any(
        relation.relation_type is causal_summary.CausalRelationType.TEMPORAL_BEFORE for relation in graph.relations
    )


@pytest.mark.asyncio
async def test_preserves_local_relation_and_does_not_classify_it_twice() -> None:
    chunks = [
        causal_summary.TextChunk("c1", 0, "폭우로 도로가 침수됐다."),
        causal_summary.TextChunk("c2", 1, "출근길 정체가 발생했다.")
    ]
    rain = causal_summary.Event("e1", "c1", 0, 0, "폭우", (1.0, 0.0), frozenset({"도로"}))
    flood = causal_summary.Event("e2", "c1", 0, 1, "도로 침수", (0.9, 0.1), frozenset({"도로"}))
    traffic = causal_summary.Event("e3", "c2", 1, 0, "출근길 정체", (0.8, 0.2), frozenset({"도로"}))
    explicit = causal_summary.CausalRelation(
        "e1", "e2", causal_summary.CausalRelationType.CAUSES, 0.99, "폭우로 도로가 침수됐다.", ("c1",)
    )
    analyzer = RecordingAnalyzer(
        {
            "c1": causal_summary.ChunkAnalysis("c1", (rain, flood), (explicit,)),
            "c2": causal_summary.ChunkAnalysis("c2", (traffic,))
        }
    )
    classifier = RecordingClassifier({})

    graph = await causal_summary.CausalGraphBuilder(analyzer, classifier).build(chunks)

    assert explicit in graph.relations
    assert all(("e1", "e2") not in batch for batch in classifier.calls)


@pytest.mark.asyncio
async def test_rejects_unsupported_or_low_confidence_causal_edges() -> None:
    chunks = [
        causal_summary.TextChunk("c1", 0, "매출이 증가했다."),
        causal_summary.TextChunk("c2", 1, "날씨가 맑았다.")
    ]
    sales = make_event("e1", "c1", 0, "매출 증가", (0.7, 0.3))
    weather = make_event("e2", "c2", 1, "맑은 날씨", (0.6, 0.4))
    analyzer = RecordingAnalyzer(
        {
            "c1": causal_summary.ChunkAnalysis("c1", (sales,)),
            "c2": causal_summary.ChunkAnalysis("c2", (weather,))
        }
    )
    classifier = RecordingClassifier(
        {
            ("e1", "e2"): causal_summary.CausalRelation(
                "e1", "e2", causal_summary.CausalRelationType.LIKELY_CAUSES, 0.60, "", ()
            )
        }
    )

    graph = await causal_summary.CausalGraphBuilder(analyzer, classifier).build(chunks)

    assert not graph.relations


@pytest.mark.asyncio
async def test_rejects_classifier_relations_outside_candidate_batch() -> None:
    chunks = [causal_summary.TextChunk("c1", 0, "사건 A"), causal_summary.TextChunk("c2", 1, "사건 B")]
    first = make_event("e1", "c1", 0, "사건 A", (1.0, 0.0))
    second = make_event("e2", "c2", 1, "사건 B", (1.0, 0.0))
    analyzer = RecordingAnalyzer(
        {
            "c1": causal_summary.ChunkAnalysis("c1", (first,)),
            "c2": causal_summary.ChunkAnalysis("c2", (second,))
        }
    )

    class HallucinatingClassifier:
        async def classify(
            self,
            candidates: Sequence[causal_summary.CausalCandidate],
            events: Mapping[str, causal_summary.Event]
        ) -> Sequence[causal_summary.CausalRelation]:
            del candidates, events
            return [
                causal_summary.CausalRelation(
                    "e2", "e1", causal_summary.CausalRelationType.CAUSES, 0.99, "근거 없음", ("c2",)
                )
            ]

    with pytest.raises(ValueError, match="outside the candidate batch"):
        await causal_summary.CausalGraphBuilder(analyzer, HallucinatingClassifier()).build(chunks)
