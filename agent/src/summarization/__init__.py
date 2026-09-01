"""Document summarization building blocks."""

from . import causal_graph as _causal_graph

CandidateReason = _causal_graph.CandidateReason
CausalCandidate = _causal_graph.CausalCandidate
CausalGraph = _causal_graph.CausalGraph
CausalGraphBuilder = _causal_graph.CausalGraphBuilder
CausalGraphConfig = _causal_graph.CausalGraphConfig
CausalRelation = _causal_graph.CausalRelation
CausalRelationType = _causal_graph.CausalRelationType
ChunkAnalysis = _causal_graph.ChunkAnalysis
Event = _causal_graph.Event
InMemoryCosineNeighborProvider = _causal_graph.InMemoryCosineNeighborProvider
TextChunk = _causal_graph.TextChunk

__all__ = [
    "CandidateReason",
    "CausalCandidate",
    "CausalGraph",
    "CausalGraphBuilder",
    "CausalGraphConfig",
    "CausalRelation",
    "CausalRelationType",
    "ChunkAnalysis",
    "Event",
    "InMemoryCosineNeighborProvider",
    "TextChunk"
]
