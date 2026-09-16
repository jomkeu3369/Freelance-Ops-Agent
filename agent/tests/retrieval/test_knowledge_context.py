# ruff: noqa: I001
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from contracts import AgentInput, AgentRunRequest, KnowledgeSearchResult, MemorySourceMessage, ModelSelection, ProjectContext, Provider, RunBudget, SafetyContextInput, TrustedRunContext  # noqa: E501, I001
from integrations.spring_tools import SpringToolError
from retrieval.knowledge_context import KnowledgeContextLoader
from runtime.runs import ExecutionAuthorization


def request() -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=uuid4(), thread_id=uuid4(), trace_id="memory-test", workspace_id=uuid4(),
            project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["project.read", "document.read", "agent.run"]  # noqa: E501
        ),
        budget=RunBudget(max_tool_calls=6, max_duration_seconds=30, max_model_calls=5, max_input_tokens=20000, max_output_tokens=1000, max_departments=4, max_hierarchy_depth=2),  # noqa: E501
        model_selection=ModelSelection(provider=Provider.OPENAI, model="test"),
        safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text="Build checkout without subscriptions")
    )


def source() -> MemorySourceMessage:
    return MemorySourceMessage(id=uuid4(), event_order=1, kind="PROJECT_INPUT", content="No subscriptions", created_at=datetime.now(UTC))  # noqa: E501


def hit(**overrides: object) -> KnowledgeSearchResult:
    values = dict(
        chunk_id=uuid4(), document_id=uuid4(), document_title="Prior analysis", source_type="PAST_PROJECT",
        content="checkout", origin="agent", memory_type="summary", confirmation_status="confirmed",
        source_messages=[source()], rrf_score=0.1, keyword_rank=1
    )
    return KnowledgeSearchResult.model_validate(values | overrides)


def setup(request: AgentRunRequest, hits: list[KnowledgeSearchResult]) -> tuple[KnowledgeContextLoader, AsyncMock, AsyncMock]:  # noqa: E501
    tools = AsyncMock()
    tools.get_project_context.return_value = ProjectContext(
        project_id=request.context.project_id, workspace_id=request.context.workspace_id, title="Checkout",
        requirement_text=request.input.requirement_text, currency="KRW", source_messages=[source()]
    )
    tools.search_knowledge.return_value = hits
    embedder = AsyncMock()
    embedder.embed.return_value = [0.1] * 1536
    return KnowledgeContextLoader(tools, embedder, "text-embedding-3-small"), tools, embedder


@pytest.mark.asyncio
async def test_only_confirmed_scoped_source_backed_documents_enter_context() -> None:
    req = request()
    allowed = hit(project_id=req.context.project_id)
    loader, tools, _ = setup(req, [
        allowed, hit(confirmation_status="unconfirmed"), hit(confirmation_status="superseded"),
        hit(memory_type="assumption"), hit(project_id=uuid4()), hit(source_messages=[])
    ])
    context = await loader.load(req, ExecutionAuthorization("signed-token"))
    payload = json.loads(context.text)
    assert [item["document_id"] for item in payload["confirmed_reference_documents"]] == [str(allowed.document_id)]
    assert payload["current_project_sources"][0]["content"] == "No subscriptions"
    assert context.document_ids == (str(allowed.document_id),)
    sent = tools.search_knowledge.call_args.kwargs["request"]
    assert sent.embedding_model == "text-embedding-3-small"
    assert tools.search_knowledge.call_args.kwargs["run_id"] == req.context.run_id
    assert context.tool_calls == 3


@pytest.mark.asyncio
async def test_embedding_failure_keeps_originals_and_uses_keyword_search() -> None:
    req = request()
    loader, tools, embedder = setup(req, [])
    embedder.embed.side_effect = RuntimeError("provider unavailable")
    context = await loader.load(req, ExecutionAuthorization("signed-token"))
    sent = tools.search_knowledge.call_args.kwargs["request"]
    assert sent.embedding is None and sent.embedding_model is None
    assert context.retrieval_mode == "keyword_fallback"
    assert json.loads(context.text)["current_project_sources"]


@pytest.mark.asyncio
async def test_scope_mismatch_fails_before_embedding_or_search() -> None:
    req = request()
    loader, tools, embedder = setup(req, [])
    tools.get_project_context.return_value = tools.get_project_context.return_value.model_copy(update={"project_id": uuid4()})  # noqa: E501
    with pytest.raises(SpringToolError, match="FORBIDDEN"):
        await loader.load(req, ExecutionAuthorization("signed-token"))
    embedder.embed.assert_not_called()
    tools.search_knowledge.assert_not_called()


@pytest.mark.asyncio
async def test_budget_and_permission_are_checked_before_calls() -> None:
    req = request()
    loader, tools, embedder = setup(req, [])
    req.budget.max_tool_calls = 2
    with pytest.raises(ValueError, match="BUDGET"):
        await loader.load(req, ExecutionAuthorization("signed-token"))
    req.context.effective_permissions = []
    assert (await loader.load(req, ExecutionAuthorization("signed-token"))).tool_calls == 0
    tools.get_project_context.assert_not_called()
    embedder.embed.assert_not_called()


@pytest.mark.asyncio
async def test_oversized_originals_are_never_silently_replaced_by_summary() -> None:
    req = request()
    loader, tools, _ = setup(req, [])
    tools.get_project_context.return_value.source_messages = [source().model_copy(update={"content": "x" * 81000})]
    with pytest.raises(ValueError, match="CONTEXT_TOO_LARGE"):
        await loader.load(req, ExecutionAuthorization("signed-token"))
