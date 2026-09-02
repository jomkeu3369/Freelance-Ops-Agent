# ruff: noqa: E501, I001

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from contracts import DepartmentName, ModelSelection, Provider, RunBudget, SourceReference
from providers import ModelGeneration
from routing import ExecutionRisk, ToolProfile
from runtime import AttemptStatus, DepartmentTask, ExecutionRoute, FailureClassification, FailureSignals, ReadOnlyResearchSpecialist, ResearchSpecialistError, ResearchSpecialistResult, ResearchTaskWorker, RetryDecision, RetryDecisionSnapshot, RetryReason, TaskAttempt, TaskAttemptEventWrite, TaskExecutionSnapshot, TaskStatus
from web_research import ResearchCollection


def budget() -> RunBudget:
    return RunBudget(max_duration_seconds=60, max_model_calls=3, max_tool_calls=4, max_input_tokens=1000, max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1, max_search_credits=1, max_retries=1)


def task(*, status: TaskStatus = TaskStatus.QUEUED) -> DepartmentTask:
    execution = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=["agent.run", "project.read"], budget=budget(), model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", risk_level=ExecutionRisk.MEDIUM, tool_profile=ToolProfile.READ_ONLY, model_profile="react-read-v1", specialist_profile="research-read-v1", authorization_revision=3, budget_revision=2)
    return DepartmentTask(task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), project_id=uuid4(), department=DepartmentName.RESEARCH, revision=1, status=status, execution=execution, created_at=datetime.now(UTC))


def attempt(value: DepartmentTask) -> TaskAttempt:
    return TaskAttempt(attempt_id=uuid4(), task_id=value.task_id, run_id=value.run_id, workspace_id=value.workspace_id, task_revision=value.revision, attempt_number=1, status=AttemptStatus.QUEUED, queued_at=datetime.now(UTC))


class FakeProvider:
    def __init__(self, summary: str) -> None:
        self._summary = summary
        self._calls = 0

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:
        del selection, prompt, max_output_tokens, max_attempts
        self._calls += 1
        if self._calls == 1:
            return ModelGeneration(payload={
                "action": "TOOL",
                "tool_name": "web_research",
                "arguments": {"query": "official policy"},
                "summary": None,
                "open_questions": [],
                "quotation_drafts": []
            }, input_tokens=10, output_tokens=5)
        return ModelGeneration(payload={
            "action": "FINAL",
            "tool_name": None,
            "arguments": {},
            "summary": self._summary,
            "open_questions": [],
            "quotation_drafts": []
        }, input_tokens=12, output_tokens=8)


class RepeatedSearchProvider:
    def __init__(self) -> None:
        self._calls = 0

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:
        del selection, prompt, max_output_tokens, max_attempts
        self._calls += 1
        if self._calls <= 2:
            return ModelGeneration(payload={"action": "TOOL", "tool_name": "web_research", "arguments": {"query": f"official policy {self._calls}"}, "summary": None, "open_questions": [], "quotation_drafts": []})
        return ModelGeneration(payload={"action": "FINAL", "tool_name": None, "arguments": {}, "summary": "Policy applies. [source:1]", "open_questions": [], "quotation_drafts": []})


class FakeResearchTool:
    async def collect(self, query: str, jurisdiction: str | None, max_search_credits: int, max_tool_calls: int) -> ResearchCollection:
        del query, jurisdiction, max_search_credits, max_tool_calls
        source = SourceReference(title="Official policy", url="https://example.gov/policy", provider="DIRECT_HTTP", content_sha256="a" * 64, fetched_at=datetime.now(UTC), authority_level="OFFICIAL", jurisdiction="KR", excerpt="The official policy text.")
        return ResearchCollection(sources=[source], search_credits=1, tool_calls=2, fetched_pages=1)


@pytest.mark.asyncio
async def test_read_only_research_specialist_returns_verified_cited_result() -> None:
    value = task()
    specialist = ReadOnlyResearchSpecialist(FakeProvider("Policy applies. [source:1]"), FakeResearchTool())

    result = await specialist.execute(value, objective="Check the official policy", jurisdiction="KR")

    assert result.verification_status == "PASSED"
    assert result.citation_count == 1
    assert result.tool_calls == 2
    assert result.department_result.sources[0].url == "https://example.gov/policy"


@pytest.mark.asyncio
async def test_research_specialist_rejects_uncited_model_result() -> None:
    specialist = ReadOnlyResearchSpecialist(FakeProvider("Unsupported conclusion."), FakeResearchTool())

    with pytest.raises(ResearchSpecialistError, match="RESEARCH_EVIDENCE_REQUIRED"):
        await specialist.execute(task(), objective="Check the official policy")


@pytest.mark.asyncio
async def test_research_specialist_rejects_uncited_public_paragraph() -> None:
    specialist = ReadOnlyResearchSpecialist(FakeProvider("Supported claim. [source:1]\nUnsupported paragraph."), FakeResearchTool())

    with pytest.raises(ResearchSpecialistError, match="RESEARCH_UNCITED_CLAIM"):
        await specialist.execute(task(), objective="Check the official policy")


@pytest.mark.asyncio
async def test_research_specialist_rejects_non_read_only_profile() -> None:
    value = task()
    value = value.model_copy(update={"execution": value.execution.model_copy(update={"tool_profile": ToolProfile.BOUNDED_WRITE})})  # noqa: E501
    specialist = ReadOnlyResearchSpecialist(FakeProvider("Policy applies. [source:1]"), FakeResearchTool())

    with pytest.raises(ResearchSpecialistError, match="RESEARCH_READ_ONLY_PROFILE_REQUIRED"):
        await specialist.execute(value, objective="Check the official policy")


@pytest.mark.asyncio
async def test_research_specialist_rejects_unregistered_profile() -> None:
    value = task()
    value = value.model_copy(update={"execution": value.execution.model_copy(update={"specialist_profile": "general-purpose-v1"})})
    specialist = ReadOnlyResearchSpecialist(FakeProvider("Policy applies. [source:1]"), FakeResearchTool())

    with pytest.raises(ResearchSpecialistError, match="RESEARCH_SPECIALIST_PROFILE_NOT_ALLOWED"):
        await specialist.execute(value, objective="Check the official policy")


@pytest.mark.asyncio
async def test_research_specialist_enforces_cumulative_search_credit_budget() -> None:
    specialist = ReadOnlyResearchSpecialist(RepeatedSearchProvider(), FakeResearchTool())

    with pytest.raises(ResearchSpecialistError, match="RESEARCH_USAGE_EXCEEDED"):
        await specialist.execute(task(), objective="Check multiple official policies")


class RecordingRegistry:
    def __init__(self) -> None:
        self.calls: list[tuple[str, TaskStatus | AttemptStatus]] = []
        self.events: list[TaskAttemptEventWrite] = []

    async def transition_task(self, task_id: UUID, revision: int, workspace_id: UUID, target: TaskStatus) -> DepartmentTask:
        del task_id, revision, workspace_id
        self.calls.append(("task", target))
        return task(status=target)

    async def transition_attempt(self, attempt_id: UUID, workspace_id: UUID, target: AttemptStatus, *, queued_at: datetime | None = None, started_at: datetime | None = None, finished_at: datetime | None = None, event: TaskAttemptEventWrite | None = None) -> TaskAttempt:
        del attempt_id, workspace_id, queued_at, started_at, finished_at
        self.calls.append(("attempt", target))
        if event is not None:
            self.events.append(event)
        value = task()
        return attempt(value).model_copy(update={"status": target})


class DenyResultFence:
    async def allows(self, task: DepartmentTask, current_attempt: TaskAttempt) -> bool:
        del task, current_attempt
        return False


@pytest.mark.asyncio
async def test_worker_emits_started_and_verified_completion_events() -> None:
    value = task()
    current_attempt = attempt(value)
    registry = RecordingRegistry()
    specialist = ReadOnlyResearchSpecialist(FakeProvider("Policy applies. [source:1]"), FakeResearchTool())
    worker = ResearchTaskWorker(registry, specialist)

    result = await worker.run(value, current_attempt, objective="Check the official policy", jurisdiction="KR", current_permissions={"agent.run", "project.read"}, current_authorization_revision=3, current_budget_revision=2, parent_budget=budget())

    assert result.verification_status == "PASSED"
    assert registry.calls == [("attempt", AttemptStatus.RUNNING), ("task", TaskStatus.RUNNING), ("attempt", AttemptStatus.COMPLETED), ("task", TaskStatus.COMPLETED)]
    assert [event.event_type for event in registry.events] == ["attempt.started", "attempt.completed"]
    assert registry.events[-1].data["result"]["verification_status"] == "PASSED"


@pytest.mark.asyncio
async def test_worker_discards_verified_result_after_cancel_or_redirect_fence() -> None:
    value = task()
    registry = RecordingRegistry()
    specialist = ReadOnlyResearchSpecialist(FakeProvider("Policy applies. [source:1]"), FakeResearchTool())
    worker = ResearchTaskWorker(registry, specialist, result_fence=DenyResultFence())  # type: ignore[arg-type]

    with pytest.raises(ResearchSpecialistError, match="RESEARCH_RESULT_SUPERSEDED"):
        await worker.run(value, attempt(value), objective="Check the official policy", jurisdiction="KR", current_permissions={"agent.run", "project.read"}, current_authorization_revision=3, current_budget_revision=2, parent_budget=budget())

    assert registry.calls == [("attempt", AttemptStatus.RUNNING), ("task", TaskStatus.RUNNING)]
    assert [event.event_type for event in registry.events] == ["attempt.started"]


@pytest.mark.asyncio
async def test_worker_emits_sanitized_failure_event_when_verification_fails() -> None:
    value = task()
    registry = RecordingRegistry()
    specialist = ReadOnlyResearchSpecialist(FakeProvider("Unsupported conclusion."), FakeResearchTool())
    worker = ResearchTaskWorker(registry, specialist)

    with pytest.raises(ResearchSpecialistError, match="RESEARCH_EVIDENCE_REQUIRED"):
        await worker.run(value, attempt(value), objective="Check the official policy", jurisdiction="KR", current_permissions={"agent.run", "project.read"}, current_authorization_revision=3, current_budget_revision=2, parent_budget=budget())  # noqa: E501

    assert registry.calls[-2:] == [("attempt", AttemptStatus.FAILED), ("task", TaskStatus.FAILED)]
    assert registry.events[-1].event_type == "attempt.failed"
    assert registry.events[-1].data == {"failure_code": "RESEARCH_EVIDENCE_REQUIRED"}


class ProviderFailureExecution:
    async def execute(self, value: DepartmentTask, *, objective: str, jurisdiction: str | None = None) -> ResearchSpecialistResult:
        del value, objective, jurisdiction
        raise ResearchSpecialistError("MODEL_PROVIDER_FAILED")


class RecordingFailureHandler:
    def __init__(self) -> None:
        self.signals: FailureSignals | None = None

    async def decide_retry(self, attempt_id: UUID, workspace_id: UUID, signals: FailureSignals, *, max_attempts: int, backoff_seconds: float = 0, source: str = "failure-classifier-v1") -> RetryDecisionSnapshot:
        del attempt_id, workspace_id, max_attempts, backoff_seconds, source
        self.signals = signals
        return RetryDecisionSnapshot(decision=RetryDecision.ALLOW, reason=RetryReason.RETRY_ALLOWED,
            failure_classification=FailureClassification.INDEPENDENT_TRANSIENT, classification_confidence=0.79,
            classifier_version="weighted-multi-signal-v1", bucket_policy_version="hierarchical-count-v1",
            workspace_tokens_before=12, workspace_tokens_after=11, global_tokens_before=16,
            global_tokens_after=15, retry_ready_at=datetime.now(UTC))


@pytest.mark.asyncio
async def test_worker_delegates_provider_failure_to_retry_policy_without_finalizing_task() -> None:
    value = task()
    registry = RecordingRegistry()
    failure_handler = RecordingFailureHandler()
    worker = ResearchTaskWorker(registry, ProviderFailureExecution(), failure_handler=failure_handler)

    with pytest.raises(ResearchSpecialistError, match="MODEL_PROVIDER_FAILED"):
        await worker.run(value, attempt(value), objective="Check provider failure", jurisdiction="KR",
            current_permissions={"agent.run", "project.read"}, current_authorization_revision=3,
            current_budget_revision=2, parent_budget=budget())

    assert registry.calls[-1] == ("attempt", AttemptStatus.FAILED)
    assert failure_handler.signals == FailureSignals(provider_error=True)
