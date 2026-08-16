"""Durable LangGraph lifecycle checkpoints stored in PostgreSQL."""

from __future__ import annotations

import asyncio
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Any, TypedDict, cast
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime

from contracts import (
    AgentInterruption,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    AgentRunUsage,
    DepartmentName,
    ResumeAgentRunRequest,
)


class CheckpointNotStartedError(RuntimeError):
    pass


class RunCheckpointState(TypedDict, total=False):
    run_id: str
    thread_id: str
    trace_id: str
    workspace_id: str
    project_id: str
    provider: str
    model: str
    status: str
    phase: str
    active_department: str | None
    error_code: str | None


class DurableExecutionState(TypedDict, total=False):
    schema_version: str
    request: dict[str, Any]
    resume: dict[str, Any] | None
    phase: str
    outcome: dict[str, Any]


@dataclass(frozen=True, slots=True)
class DurableExecutionContext:
    executor: Any
    authorization: Any


class PostgresCheckpointJournal:
    """Own AsyncPostgresSaver and record resumable public-safe lifecycle snapshots."""

    def __init__(self, database_url: str, *, open_timeout_seconds: float = 10.0) -> None:
        if open_timeout_seconds <= 0:
            raise ValueError("checkpoint open timeout must be positive")
        self._database_url = self._with_agent_search_path(database_url)
        self._open_timeout_seconds = open_timeout_seconds
        self._context: AbstractAsyncContextManager[AsyncPostgresSaver] | None = None
        self._saver: AsyncPostgresSaver | None = None
        self._graph: Any = None
        self._execution_graph: Any = None

    @property
    def is_open(self) -> bool:
        return self._saver is not None and self._graph is not None and self._execution_graph is not None

    async def open(self) -> None:
        if self.is_open:
            return
        # pickle fallback을 끄고 허용 모듈을 비워 손상된 checkpoint의 임의 객체 복원을 막는다.
        serializer = JsonPlusSerializer(pickle_fallback=False, allowed_msgpack_modules=[])
        context = cast(
            AbstractAsyncContextManager[AsyncPostgresSaver],
            AsyncPostgresSaver.from_conn_string(self._database_url, serde=serializer),
        )
        saver = await context.__aenter__()
        try:
            await asyncio.wait_for(saver.setup(), timeout=self._open_timeout_seconds)
        except BaseException:
            await context.__aexit__(None, None, None)
            raise
        self._context = context
        self._saver = saver
        self._graph = self._compile(saver)
        self._execution_graph = self._compile_execution(saver)

    async def close(self) -> None:
        context = self._context
        self._context = None
        self._saver = None
        self._graph = None
        self._execution_graph = None
        if context is not None:
            await context.__aexit__(None, None, None)

    async def record(
        self,
        request: AgentRunRequest,
        status: AgentRunStatus,
        phase: str,
        *,
        active_department: DepartmentName | None = None,
        error_code: str | None = None,
    ) -> None:
        if self._graph is None:
            raise CheckpointNotStartedError("LangGraph PostgreSQL checkpointer is not open")
        context = request.context
        state: RunCheckpointState = {
            "run_id": str(context.run_id),
            "thread_id": str(context.thread_id),
            "trace_id": context.trace_id,
            "workspace_id": str(context.workspace_id),
            "project_id": str(context.project_id),
            "provider": request.model_selection.provider.value,
            "model": request.model_selection.model,
            "status": status.value,
            "phase": phase,
            "active_department": active_department.value if active_department is not None else None,
            "error_code": error_code,
        }
        config = {
            "configurable": {
                "thread_id": f"lifecycle:{context.thread_id}:{context.run_id}",
            },
            "tags": ["freelance-ops-agent", "run-lifecycle"],
            "metadata": {
                "service": "freelance-ops-agent",
                "run_id": str(context.run_id),
                "workspace_id": str(context.workspace_id),
                "project_id": str(context.project_id),
                "provider": request.model_selection.provider.value,
                "model": request.model_selection.model,
                "phase": phase,
            },
        }
        await self._graph.ainvoke(state, config)

    async def execute(self, executor: Any, request: AgentRunRequest, resume: ResumeAgentRunRequest | None, authorization: Any) -> Any:  # noqa: E501
        if self._execution_graph is None:
            raise CheckpointNotStartedError("LangGraph PostgreSQL checkpointer is not open")
        state: DurableExecutionState = {
            "schema_version": "agent-execution-v1",
            "request": request.model_dump(mode="json"),
            "resume": resume.model_dump(mode="json") if resume is not None else None,
            "phase": "received",
        }
        config = {
            "configurable": {
                "thread_id": str(request.context.thread_id),
            }
        }
        result = await self._execution_graph.ainvoke(
            state,
            config,
            context=DurableExecutionContext(executor=executor, authorization=authorization),
        )
        return self._deserialize_outcome(result["outcome"])

    @staticmethod
    def _compile(saver: AsyncPostgresSaver) -> Any:
        async def persist(state: RunCheckpointState) -> RunCheckpointState:
            return state

        builder = StateGraph(RunCheckpointState)
        builder.add_node("persist_lifecycle", persist)
        builder.add_edge(START, "persist_lifecycle")
        builder.add_edge("persist_lifecycle", END)
        return builder.compile(checkpointer=saver)

    @staticmethod
    def _compile_execution(saver: AsyncPostgresSaver) -> Any:
        async def prepare(state: DurableExecutionState) -> dict[str, str]:
            del state
            return {"phase": "prepared"}

        async def execute(state: DurableExecutionState, runtime: Runtime[DurableExecutionContext]) -> dict[str, object]:
            request = AgentRunRequest.model_validate(state["request"])
            resume_value = state.get("resume")
            resume = ResumeAgentRunRequest.model_validate(resume_value) if resume_value is not None else None
            outcome = await runtime.context.executor.execute(
                request,
                resume,
                runtime.context.authorization,
            )
            return {"phase": "executed", "outcome": PostgresCheckpointJournal._serialize_outcome(outcome)}

        builder = StateGraph(DurableExecutionState, context_schema=DurableExecutionContext)
        builder.add_node("prepare_execution", prepare)
        builder.add_node("execute_agent", execute)
        builder.add_edge(START, "prepare_execution")
        builder.add_edge("prepare_execution", "execute_agent")
        builder.add_edge("execute_agent", END)
        return builder.compile(checkpointer=saver)

    @staticmethod
    def _serialize_outcome(outcome: Any) -> dict[str, Any]:
        return {
            "result": outcome.result.model_dump(mode="json") if outcome.result is not None else None,
            "interruption": (
                outcome.interruption.model_dump(mode="json") if outcome.interruption is not None else None
            ),
            "active_department": outcome.active_department.value if outcome.active_department is not None else None,
            "usage": outcome.usage.model_dump(mode="json") if outcome.usage is not None else None,
            "events": [{"type": event.type, "data": event.data} for event in outcome.events],
            "partial_error_code": outcome.partial_error_code,
        }

    @staticmethod
    def _deserialize_outcome(value: dict[str, Any]) -> Any:
        from runtime.runs import ExecutionEvent, ExecutionOutcome

        result = value.get("result")
        interruption = value.get("interruption")
        department = value.get("active_department")
        usage = value.get("usage")
        return ExecutionOutcome(
            result=AgentRunResult.model_validate(result) if result is not None else None,
            interruption=AgentInterruption.model_validate(interruption) if interruption is not None else None,
            active_department=DepartmentName(department) if department is not None else None,
            usage=AgentRunUsage.model_validate(usage) if usage is not None else None,
            events=tuple(
                ExecutionEvent(type=event["type"], data=event.get("data", {}))
                for event in value.get("events", [])
            ),
            partial_error_code=value.get("partial_error_code")
        )

    @staticmethod
    def _with_agent_search_path(database_url: str) -> str:
        parts = urlsplit(database_url)
        if parts.scheme not in {"postgresql", "postgres", "postgresql+psycopg"}:
            raise ValueError("checkpoint database URL must use PostgreSQL")
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query["options"] = "-c search_path=agent_runtime,public"
        normalized_scheme = "postgresql" if parts.scheme == "postgresql+psycopg" else parts.scheme
        return urlunsplit(
            (
                normalized_scheme,
                parts.netloc,
                parts.path,
                urlencode(query, quote_via=quote),
                parts.fragment,
            )
        )
