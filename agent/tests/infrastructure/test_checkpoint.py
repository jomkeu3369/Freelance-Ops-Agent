from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from contracts import (
    AgentInput,
    AgentRunRequest,
    AgentRunStatus,
    ModelSelection,
    Provider,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from infrastructure.checkpoint import CheckpointNotStartedError, PostgresCheckpointJournal


def _request() -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=uuid4(),
            thread_id=uuid4(),
            trace_id="trace-checkpoint",
            workspace_id=uuid4(),
            project_id=uuid4(),
            initiated_by=uuid4(),
            effective_permissions=["agent.run"],
        ),
        budget=RunBudget(
            max_duration_seconds=30,
            max_model_calls=2,
            max_tool_calls=1,
            max_input_tokens=1000,
            max_output_tokens=1000,
            max_departments=1,
            max_hierarchy_depth=1,
        ),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text="checkpoint test"),
    )


def test_checkpoint_url_forces_agent_runtime_search_path() -> None:
    value = PostgresCheckpointJournal._with_agent_search_path("postgresql+psycopg://user:secret@db/app?sslmode=disable")

    assert value.startswith("postgresql://")
    assert "options=-c%20" in value
    assert "search_path%3Dagent_runtime%2Cpublic" in value
    assert "sslmode=disable" in value


@pytest.mark.asyncio
async def test_record_requires_started_checkpointer() -> None:
    journal = PostgresCheckpointJournal("postgresql://user:secret@db/app")

    with pytest.raises(CheckpointNotStartedError):
        await journal.record(_request(), AgentRunStatus.QUEUED, "accepted")


@pytest.mark.asyncio
async def test_record_uses_thread_and_run_namespace() -> None:
    class FakeGraph:
        def __init__(self) -> None:
            self.calls: list[tuple[dict[str, object], dict[str, object]]] = []

        async def ainvoke(self, state: dict[str, object], config: dict[str, object]) -> None:
            self.calls.append((state, config))

    graph = FakeGraph()
    journal = PostgresCheckpointJournal("postgresql://user:secret@db/app")
    journal._graph = cast(Any, graph)
    journal._saver = cast(Any, SimpleNamespace(created_at=datetime.now(UTC)))
    request = _request()

    await journal.record(request, AgentRunStatus.RUNNING, "execution_started")

    state, config = graph.calls[0]
    assert state["run_id"] == str(request.context.run_id)
    assert state["provider"] == "OPENAI"
    configurable = cast(dict[str, str], config["configurable"])
    assert configurable["thread_id"] == f"lifecycle:{request.context.thread_id}:{request.context.run_id}"
    assert config["tags"] == ["freelance-ops-agent", "run-lifecycle"]
    metadata = cast(dict[str, str], config["metadata"])
    assert metadata["run_id"] == str(request.context.run_id)
    assert metadata["workspace_id"] == str(request.context.workspace_id)
    assert metadata["phase"] == "execution_started"


@pytest.mark.asyncio
async def test_open_runs_official_saver_setup_and_close(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSaver:
        def __init__(self) -> None:
            self.setup_calls = 0

        async def setup(self) -> None:
            self.setup_calls += 1

    class FakeContext:
        def __init__(self, saver: FakeSaver) -> None:
            self.saver = saver
            self.exit_calls = 0

        async def __aenter__(self) -> FakeSaver:
            return self.saver

        async def __aexit__(self, *args: object) -> None:
            del args
            self.exit_calls += 1

    saver = FakeSaver()
    context = FakeContext(saver)
    journal = PostgresCheckpointJournal("postgresql://user:secret@db/app")
    monkeypatch.setattr(
        "infrastructure.checkpoint.AsyncPostgresSaver.from_conn_string",
        lambda *args, **kwargs: context,
    )
    monkeypatch.setattr(journal, "_compile", lambda value: SimpleNamespace(saver=value))
    monkeypatch.setattr(journal, "_compile_execution", lambda value: SimpleNamespace(saver=value))

    await journal.open()
    await journal.close()

    assert saver.setup_calls == 1
    assert context.exit_calls == 1
    assert not journal.is_open


@pytest.mark.asyncio
async def test_durable_execution_graph_keeps_authorization_out_of_checkpoint_state() -> None:
    from runtime import ExecutionAuthorization, ExecutionEvent, ExecutionOutcome

    class Executor:
        token: str | None = None

        async def execute(self, request: AgentRunRequest, resume: object = None, authorization: object = None) -> ExecutionOutcome:  # noqa: E501
            del resume
            assert isinstance(authorization, ExecutionAuthorization)
            self.token = authorization.delegation_token
            from contracts import AgentRunResult

            return ExecutionOutcome(
                result=AgentRunResult(project_summary=request.input.requirement_text),
                events=(ExecutionEvent("route.selected", {"route": "REACT_AGENT"}),)
            )

    request = _request()
    saver = InMemorySaver()
    journal = PostgresCheckpointJournal("postgresql://user:secret@db/app")
    journal._execution_graph = journal._compile_execution(cast(Any, saver))
    executor = Executor()

    outcome = await journal.execute(
        executor,
        request,
        None,
        ExecutionAuthorization("transient-delegation-token"),
    )
    config = {
        "configurable": {
            "thread_id": str(request.context.thread_id),
        }
    }
    snapshot = await journal._execution_graph.aget_state(config)

    assert outcome.result is not None
    assert outcome.events == (ExecutionEvent("route.selected", {"route": "REACT_AGENT"}),)
    assert executor.token == "transient-delegation-token"
    assert snapshot.values["phase"] == "executed"
    assert "transient-delegation-token" not in repr(snapshot.values)


@pytest.mark.asyncio
async def test_durable_execution_graph_resumes_the_same_thread() -> None:
    from contracts import AgentInterruption, AgentRunResult, InterruptionKind, ResumeAgentRunRequest, ResumeAnswer
    from runtime import ExecutionOutcome

    class Executor:
        calls = 0

        async def execute(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None = None, authorization: object = None) -> ExecutionOutcome:  # noqa: E501
            del request, authorization
            self.calls += 1
            if resume is None:
                return ExecutionOutcome(
                    interruption=AgentInterruption(
                        interruption_id=uuid4(),
                        kind=InterruptionKind.CLARIFICATION,
                        questions=["납기일은?"],
                    )
                )
            return ExecutionOutcome(result=AgentRunResult(project_summary=resume.answers[0].answer))

    saver = InMemorySaver()
    journal = PostgresCheckpointJournal("postgresql://user:secret@db/app")
    journal._execution_graph = journal._compile_execution(cast(Any, saver))
    executor = Executor()
    request = _request()
    first = await journal.execute(executor, request, None, None)
    assert first.interruption is not None

    resumed = await journal.execute(
        executor,
        request,
        ResumeAgentRunRequest(
            interruption_id=first.interruption.interruption_id,
            idempotency_key="resume-key-1",
            answers=[ResumeAnswer(question_index=0, answer="2026-09-30")],
        ),
        None,
    )

    assert resumed.result is not None
    assert resumed.result.project_summary == "2026-09-30"
    assert executor.calls == 2
