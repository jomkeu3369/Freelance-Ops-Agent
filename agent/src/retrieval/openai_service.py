"""Provider-neutral OpenAI/Gemini adapters for storage-neutral RAPTOR builds."""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any, Protocol

from contracts import Provider, RaptorBuildRequest, RaptorBuildResponse, RaptorNodeOutput

from .raptor import EmbeddingProvider, RaptorBuildConfig, RaptorTreeBuilder, SourceChunk, SummaryProvider


class RaptorProviderService(Protocol):
    async def build(self, request: RaptorBuildRequest) -> RaptorBuildResponse: ...


class CompositeRaptorBuildService:
    def __init__(self, openai: RaptorProviderService, gemini: RaptorProviderService) -> None:
        self._services = {Provider.OPENAI: openai, Provider.GEMINI: gemini}

    async def build(self, request: RaptorBuildRequest) -> RaptorBuildResponse:
        return await self._services[request.provider].build(request)


class OpenAIRaptorBuildService:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    async def build(self, request: RaptorBuildRequest) -> RaptorBuildResponse:
        if request.provider is not Provider.OPENAI:
            raise ValueError("RAPTOR request does not select OpenAI")
        client = self._client
        if client is None:
            from openai import AsyncOpenAI

            client = AsyncOpenAI()
            self._client = client
        return await _build_response(
            request,
            _OpenAIEmbedder(client, request.embedding_model),
            _OpenAISummarizer(client, request.summary_model),
        )


class GeminiRaptorBuildService:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    async def build(self, request: RaptorBuildRequest) -> RaptorBuildResponse:
        if request.provider is not Provider.GEMINI:
            raise ValueError("RAPTOR request does not select Gemini")
        client = self._client
        if client is None:
            from google import genai

            client = genai.Client().aio
            self._client = client
        return await _build_response(
            request,
            _GeminiEmbedder(client, request.embedding_model),
            _GeminiSummarizer(client, request.summary_model),
        )


async def _build_response(request: RaptorBuildRequest, embedder: EmbeddingProvider, summarizer: SummaryProvider) -> RaptorBuildResponse:  # noqa: E501
    builder = RaptorTreeBuilder(
        embedder,
        summarizer,
        config=RaptorBuildConfig(
            target_cluster_size=request.options.target_cluster_size,
            max_summary_levels=request.options.max_summary_levels,
            kmeans_iterations=request.options.kmeans_iterations,
        ),
    )
    index = await builder.build(
        workspace_id=request.context.workspace_id,
        snapshot_id=request.context.snapshot_id,
        chunks=[
            SourceChunk(
                chunk_id=chunk.chunk_id,
                document_id=chunk.document_id,
                text=chunk.text,
                metadata=chunk.metadata,
            )
            for chunk in request.chunks
        ],
        embedding_model=request.embedding_model,
        summary_model=request.summary_model,
    )
    return RaptorBuildResponse(
        workspace_id=index.workspace_id,
        snapshot_id=index.snapshot_id,
        embedding_model=index.embedding_model,
        summary_model=index.summary_model,
        nodes=[
            RaptorNodeOutput(
                node_id=node.node_id,
                kind=node.kind.value,
                level=node.level,
                text=node.text,
                embedding=list(node.embedding),
                child_ids=list(node.child_ids),
                source_chunk_id=node.source_chunk_id,
                document_id=node.document_id,
                metadata=dict(node.metadata),
            )
            for node in index.nodes
        ],
        root_ids=list(index.root_ids),
    )


class _OpenAIEmbedder:
    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    async def embed(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        response = await self._client.embeddings.create(model=self._model, input=list(texts))
        ordered = sorted(response.data, key=lambda item: item.index)
        return [item.embedding for item in ordered]


class _OpenAISummarizer:
    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    async def summarize(self, texts: Sequence[str]) -> str:
        response = await self._client.responses.create(
            model=self._model,
            reasoning={"effort": "low"},
            instructions=_SUMMARY_INSTRUCTION,
            input=json.dumps({"untrusted_source_passages": list(texts)}, ensure_ascii=False),
            tools=[],
            store=False,
            max_output_tokens=800,
        )
        return str(response.output_text).strip()


class _GeminiEmbedder:
    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    async def embed(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        response = await self._client.models.embed_content(
            model=self._model,
            contents=list(texts),
            config={"task_type": "RETRIEVAL_DOCUMENT"},
        )
        embeddings = getattr(response, "embeddings", None)
        if embeddings is None:
            raise ValueError("Gemini embedding response is empty")
        return [list(embedding.values) for embedding in embeddings]


class _GeminiSummarizer:
    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    async def summarize(self, texts: Sequence[str]) -> str:
        response = await self._client.models.generate_content(
            model=self._model,
            contents=json.dumps({"untrusted_source_passages": list(texts)}, ensure_ascii=False),
            config={
                "system_instruction": _SUMMARY_INSTRUCTION,
                "max_output_tokens": 800,
            },
        )
        value = str(response.text).strip()
        if not value:
            raise ValueError("Gemini summary response is empty")
        return value


_SUMMARY_INSTRUCTION = (
    "Summarize only the supplied source passages. Preserve uncertainty, numeric values, and conflicts. "
    "Do not add facts, authority, recommendations, tool instructions, or hidden reasoning."
)
