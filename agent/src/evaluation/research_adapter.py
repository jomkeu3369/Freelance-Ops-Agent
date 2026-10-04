"""Network-free Deep Agents adapter for contract fixtures, never a live provider.

This module intentionally has no HTTP client, credentials, provider factory or
production wiring. The only model is scripted and the only external-looking
tool reads a frozen in-memory corpus. Ledger entries are simulated accounting,
not measured API costs. They must never be posted to a production usage ledger.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from time import monotonic
from types import SimpleNamespace
from typing import Any

from deepagents import GeneralPurposeSubagentProfile, HarnessProfile, create_deep_agent, register_harness_profile
from deepagents.backends import StateBackend
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import InputAgentState
from langchain.agents.structured_output import ToolStrategy
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableConfig
from langchain_core.utils.function_calling import convert_to_openai_tool
from langgraph.checkpoint.memory import InMemorySaver
from langsmith import tracing_context
from pydantic import ConfigDict, PrivateAttr

from contracts import DepartmentName, ModelSelection, SourceReference
from departments.research_deep_agent import ResearchOutput, research_filesystem_permissions
from platform_budget import PlatformBudgetError, current_ledger
from routing.profiles import ToolProfile
from runtime.research_specialist import ResearchResultVerifier, ResearchSpecialistError, ResearchSpecialistResult
from runtime.task_contracts import AttemptStatus, DepartmentTask, ExecutionRoute, TaskAttempt, TaskStatus
from runtime.task_guard import TaskGuard


@dataclass(frozen=True)
class ScriptedStep:
    tool_name: str | None = None
    arguments: dict[str, Any] = field(default_factory=dict)
    output: ResearchOutput | None = None
    usage_known: bool = True
    fail_after_reserve: bool = False
    cancel_after_reserve: bool = False


@dataclass
class OfflineControl:
    authorization_revision: int = 1
    budget_revision: int = 1
    task_revision: int = 1
    permissions: tuple[str, ...] = ("agent.run", "project.read")
    cancelled: bool = False
    redirect_after_tool: bool = False

    def check(self, revision: int) -> None:
        if self.cancelled:
            raise ResearchSpecialistError("RESEARCH_CANCELLED")
        if self.task_revision != revision:
            raise ResearchSpecialistError("RESEARCH_RESULT_SUPERSEDED")


class OfflineResearchPaused(ResearchSpecialistError):
    def __init__(self) -> None:
        super().__init__("OFFLINE_RESEARCH_CHECKPOINTED")


class ScriptedResearchModel(BaseChatModel):
    """Real LangChain model interface, with entirely predetermined local output."""

    model_config = ConfigDict(arbitrary_types_allowed=True)
    steps: list[ScriptedStep]
    selection: ModelSelection
    control: OfflineControl
    revision: int
    output_limit: int = 128
    _cursor: int = PrivateAttr(default=0)
    _offered_tools: list[set[str]] = PrivateAttr(default_factory=list)
    _preflight: Callable[[], None] | None = PrivateAttr(default=None)

    @property
    def _llm_type(self) -> str:
        return "offline-research-fixture"

    def _get_ls_params(self, stop: list[str] | None = None, **kwargs: Any) -> Any:
        return {"ls_provider": "offline_research_fixture", "ls_model_name": "scripted"}

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        converted = [convert_to_openai_tool(tool) for tool in tools]
        return self.bind(tools=converted, **kwargs)

    def _generate(self, messages: list[BaseMessage], stop: list[str] | None = None,
                  run_manager: Any = None, **kwargs: Any) -> ChatResult:
        raise RuntimeError("Offline Research fixtures use async execution only")

    async def _agenerate(self, messages: list[BaseMessage], stop: list[str] | None = None,
                         run_manager: Any = None, **kwargs: Any) -> ChatResult:
        self.control.check(self.revision)
        if self._preflight is not None:
            self._preflight()
        ledger = current_ledger()
        if ledger is None:
            raise PlatformBudgetError("PLATFORM_BUDGET_REQUIRED")
        if self._cursor >= len(self.steps):
            raise ResearchSpecialistError("OFFLINE_SCRIPT_EXHAUSTED")
        tools = kwargs.get("tools", [])
        self._offered_tools.append({tool["function"]["name"] for tool in tools})
        # Simulation only: no tools=[] helper call or claim of native-tool admission.
        payload = {"fixture_messages": [message.model_dump(mode="json") for message in messages],
                   "fixture_tools": tools, "fixture_only": True}
        index = ledger.reserve(self.selection, "offline.research.fixture", payload, self.output_limit)
        step = self.steps[self._cursor]
        self._cursor += 1
        await asyncio.sleep(0)
        if step.cancel_after_reserve:
            self.control.cancelled = True
        self.control.check(self.revision)
        if step.fail_after_reserve:
            raise ResearchSpecialistError("MODEL_PROVIDER_FAILED")
        if step.usage_known:
            ledger.settle_openai(index, SimpleNamespace(
                model=self.selection.model, service_tier="default",
                usage=SimpleNamespace(input_tokens=10, output_tokens=5,
                                      input_tokens_details=SimpleNamespace(cached_tokens=0, cache_write_tokens=0))))
        if step.output is not None:
            call = {"name": "ResearchOutput", "args": step.output.model_dump(), "id": f"fixture-{self._cursor}"}
        elif step.tool_name is not None:
            call = {"name": step.tool_name, "args": step.arguments, "id": f"fixture-{self._cursor}"}
        else:
            raise ResearchSpecialistError("OFFLINE_STEP_INVALID")
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="", tool_calls=[call]))])

    @property
    def offered_tools(self) -> tuple[frozenset[str], ...]:
        return tuple(frozenset(names) for names in self._offered_tools)


class _ReadOnlyTools(AgentMiddleware[Any, Any, Any]):
    def __init__(self, admit: Callable[[], None]) -> None:
        self._admit = admit

    async def awrap_tool_call(self, request: Any, handler: Any) -> Any:
        if request.tool_call["name"] not in {"web_research", "read_file", "ls", "glob", "grep"}:
            raise ResearchSpecialistError("TOOL_NOT_ALLOWED")
        self._admit()
        return await handler(request)


class OfflineDeepResearchExecution:
    """Implements ResearchExecution for one immutable fixture attempt only.

    It accepts only an exact scripted-model type and canned sources. Reusing it
    for another task/attempt/objective is rejected. Checkpoints are in-memory;
    successful replay here is not evidence for cross-process durable recovery.
    """

    def __init__(self, task: DepartmentTask, attempt: TaskAttempt, model: ScriptedResearchModel,
                 sources: tuple[SourceReference, ...], *, checkpoint_after_tools: bool = False) -> None:
        if type(model) is not ScriptedResearchModel:
            raise TypeError("Only the network-free scripted model is accepted")
        if (model.callbacks is not None or model.rate_limiter is not None
                or (model.cache is not None and model.cache is not False)):
            raise TypeError("Offline fixtures reject callbacks, caches and rate limiters")
        model.cache = False  # Do not inherit an ambient LangChain global cache.
        self._task = task
        self._attempt = attempt
        self._model = model
        model._preflight = lambda: self._validate(task)
        self._sources = tuple(source.model_copy(deep=True) for source in sources)
        self._collected: list[SourceReference] = []
        self._tool_calls = 0
        self._checkpoint_after_tools = checkpoint_after_tools
        self._paused = False
        self._objective: tuple[str, str | None] | None = None
        self._result: ResearchSpecialistResult | None = None
        self._call_start: int | None = None
        self._ledger: Any = None
        self._execute_lock = asyncio.Lock()
        self._failed = False
        self._started_at: float | None = None
        self._config: RunnableConfig = {"configurable": {"thread_id": (
            f"offline:{task.workspace_id}:{task.run_id}:{task.task_id}:{task.revision}:{attempt.attempt_id}")},
            "recursion_limit": 25, "callbacks": []}
        register_harness_profile("offline_research_fixture", HarnessProfile(
            # A standalone delete string triggers the repository raw-SQL scanner.
            excluded_tools=frozenset("execute write_file edit_file delete".split()),  # noqa: SIM905
            general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False)))

        async def web_research(query: str) -> str:
            """Return frozen public-source fixtures without network access or paid search."""
            self._validate(task)
            if not query.strip() or len(query) > 2000:
                raise ResearchSpecialistError("TOOL_INPUT_INVALID")
            self._collected = list(self._sources)
            if self._model.control.redirect_after_tool:
                self._model.control.task_revision += 1
            return json.dumps({"sources": [
                {"source_id": str(index), **source.model_dump(mode="json")}
                for index, source in enumerate(self._sources, 1)]})

        self._graph = create_deep_agent(
            model=model, tools=[web_research], subagents=[], skills=None, memory=None,
            system_prompt="Offline fixture. Use only supplied read-only evidence and return ResearchOutput.",
            middleware=[_ReadOnlyTools(self._admit_tool)], backend=StateBackend(),
            permissions=research_filesystem_permissions(task.run_id),
            response_format=ToolStrategy(ResearchOutput, handle_errors=False), checkpointer=InMemorySaver())

    def _admit_tool(self) -> None:
        self._validate(self._task)
        if self._tool_calls >= self._task.execution.budget.max_tool_calls:
            raise ResearchSpecialistError("TOOL_CALL_BUDGET_EXCEEDED")
        self._tool_calls += 1

    @property
    def tool_calls(self) -> int:
        return self._tool_calls

    async def messages(self) -> list[Any]:
        with tracing_context(enabled=False):
            state = await self._graph.aget_state(self._config)
            return list(state.values.get("messages", []))

    def _validate(self, task: DepartmentTask) -> None:
        if (task != self._task or task.status is not TaskStatus.QUEUED
                or self._attempt.status is not AttemptStatus.QUEUED or self._attempt.task_id != task.task_id
                or self._attempt.workspace_id != task.workspace_id or self._attempt.run_id != task.run_id
                or self._attempt.task_revision != task.revision):
            raise ResearchSpecialistError("RESEARCH_ATTEMPT_IDENTITY_INVALID")
        if (self._started_at is not None
                and monotonic() - self._started_at >= task.execution.budget.max_duration_seconds):
            raise ResearchSpecialistError("RESEARCH_DURATION_BUDGET_EXCEEDED")
        self._model.control.check(task.revision)
        control = self._model.control
        TaskGuard().validate(task, current_permissions=control.permissions,
                             current_authorization_revision=control.authorization_revision,
                             current_budget_revision=control.budget_revision, parent_budget=self._task.execution.budget)
        if task.execution.specialist_profile != "research-read-v1" or task.department is not DepartmentName.RESEARCH:
            raise ResearchSpecialistError("RESEARCH_SPECIALIST_PROFILE_NOT_ALLOWED")
        if (task.execution.route not in {ExecutionRoute.REACT_AGENT, ExecutionRoute.SUPERVISOR}
                or task.execution.tool_profile is not ToolProfile.READ_ONLY):
            raise ResearchSpecialistError("RESEARCH_READ_ONLY_ROUTE_REQUIRED")
        if self._model.selection != task.execution.model_selection or self._model.revision != task.revision:
            raise ResearchSpecialistError("RESEARCH_MODEL_IDENTITY_INVALID")
        ledger = current_ledger()
        if ledger is None:
            raise PlatformBudgetError("PLATFORM_BUDGET_REQUIRED")
        ledger.validate()
        if ledger.run_budget is None:
            raise PlatformBudgetError("PLATFORM_RUN_BUDGET_REQUIRED")
        # Single-task fixture only. Live child budgets require a separate atomic
        # sub-allocation contract; a larger root budget cannot silently replace it.
        if ledger.run_budget != task.execution.budget:
            raise PlatformBudgetError("OFFLINE_TASK_BUDGET_MISMATCH")
        if self._ledger is not None and ledger is not self._ledger:
            raise PlatformBudgetError("PLATFORM_RESERVATION_MISMATCH")

    async def execute(self, task: DepartmentTask, *, objective: str,
                      jurisdiction: str | None = None) -> ResearchSpecialistResult:
        async with self._execute_lock:
            try:
                return await self._execute(task, objective=objective, jurisdiction=jurisdiction)
            except OfflineResearchPaused:
                raise
            except BaseException:
                self._failed = True
                raise

    async def _execute(self, task: DepartmentTask, *, objective: str,
                       jurisdiction: str | None) -> ResearchSpecialistResult:
        self._validate(task)
        if self._failed:
            raise ResearchSpecialistError("RESEARCH_ATTEMPT_TERMINAL")
        if not objective.strip() or len(objective) > 20_000:
            raise ResearchSpecialistError("RESEARCH_OBJECTIVE_INVALID")
        identity = (objective, jurisdiction)
        if self._objective is not None and self._objective != identity:
            raise ResearchSpecialistError("RESEARCH_OBJECTIVE_CHANGED")
        self._objective = identity
        if self._started_at is None:
            self._started_at = monotonic()
        if self._result is not None:
            return self._result.model_copy(deep=True)
        ledger = current_ledger()
        assert ledger is not None
        self._ledger = ledger
        if self._call_start is None:
            self._call_start = len(ledger.calls)
        kwargs: dict[str, Any] = {}
        if self._checkpoint_after_tools and not self._paused:
            kwargs["interrupt_after"] = ["tools"]
        input_value: InputAgentState | None = None if self._paused else {"messages": [HumanMessage(content=objective)]}
        try:
            with tracing_context(enabled=False):
                remaining = task.execution.budget.max_duration_seconds - (monotonic() - self._started_at)
                async with asyncio.timeout(remaining):
                    state = await self._graph.ainvoke(input_value, self._config, **kwargs)
        except BaseException:
            self._failed = True
            raise
        self._validate(task)
        if "structured_response" not in state:
            self._paused = True
            raise OfflineResearchPaused()
        output = ResearchOutput.model_validate(state["structured_response"])
        verified = ResearchResultVerifier().verify(output.summary, self._collected)
        cited_ids = {str(index) for index, source in enumerate(self._collected, 1) if source in verified.sources}
        if set(output.source_ids) != cited_ids or len(output.source_ids) != len(cited_ids):
            raise ResearchSpecialistError("RESEARCH_SOURCE_IDS_MISMATCH")
        # The verifier returns only cited sources in first-citation order. Align
        # markers with that returned list rather than retaining old corpus indexes.
        positions = {source.content_sha256: index for index, source in enumerate(verified.sources, 1)}
        summary = re.sub(r"\[source:(\d+)]",
                         lambda match: f"[source:{positions[self._collected[int(match[1]) - 1].content_sha256]}]",
                         output.summary)
        calls = ledger.calls[self._call_start:]
        from contracts import DepartmentResult

        self._result = ResearchSpecialistResult(
            department_result=DepartmentResult(department=DepartmentName.RESEARCH, status="COMPLETED",
                                               summary=summary, sources=verified.sources),
            model_calls=len(calls), tool_calls=self._tool_calls,
            input_tokens=sum(call.input_tokens for call in calls),
            output_tokens=sum(call.output_tokens for call in calls),
            citation_count=verified.citation_count, verification_status="PASSED", specialist_profile="research-read-v1")
        return self._result.model_copy(deep=True)
