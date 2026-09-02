"""Shadow registration identity tests."""

# ruff: noqa: E501, I001

from datetime import UTC, datetime
from uuid import UUID, uuid4

from contracts import AgentInput, AgentRunRequest, ModelSelection, Provider, RunBudget, SafetyContextInput, TrustedRunContext
from integrations.task_registration import SpringTaskRegistration
from routing import FinalRouteDecision, RouteDecisionSource, RouteLabel, SafetyContext
from runtime import AttemptStatus, DepartmentTask, PostgresResearchTaskShadowRegistrar, TaskAttempt, TaskStatus
from runtime.task_registry import AttemptNotFoundError, TaskNotFoundError


class RecordingSpringRegistration:
    def __init__(self, request: AgentRunRequest) -> None:
        self.request = request
        self.payloads: list[dict[str, object]] = []
        self.tokens: list[str] = []

    async def register(self, payload: dict[str, object], workload_token: str) -> SpringTaskRegistration:
        self.payloads.append(payload)
        self.tokens.append(workload_token)
        now = datetime.now(UTC)
        return SpringTaskRegistration.model_validate({"task": {"taskId": payload["taskId"], "workspaceId": str(self.request.context.workspace_id), "runId": str(self.request.context.run_id), "status": "DISPATCHED", "revision": 1, "currentAttemptNumber": 1}, "attempt": {"attemptId": payload["attemptId"], "taskId": payload["taskId"], "taskRevision": 1, "attemptNumber": 1, "status": "QUEUED", "queuedAt": now.isoformat()}, "authorizationRevision": 9, "budgetRevision": 1})  # noqa: E501


class MemoryRegistry:
    def __init__(self) -> None:
        self.tasks: dict[tuple[UUID, int], DepartmentTask] = {}
        self.attempts: dict[UUID, TaskAttempt] = {}
        self.task_creations = 0
        self.attempt_creations = 0

    async def get_task(self, task_id: UUID, revision: int, workspace_id: UUID) -> DepartmentTask:
        del workspace_id
        try:
            return self.tasks[(task_id, revision)]
        except KeyError as error:
            raise TaskNotFoundError from error

    async def create_task(self, task: DepartmentTask) -> DepartmentTask:
        self.task_creations += 1
        self.tasks[(task.task_id, task.revision)] = task
        return task

    async def transition_task(self, task_id: UUID, revision: int, workspace_id: UUID, target: TaskStatus) -> DepartmentTask:
        del workspace_id
        task = self.tasks[(task_id, revision)].model_copy(update={"status": target})
        self.tasks[(task_id, revision)] = task
        return task

    async def get_attempt(self, attempt_id: UUID, workspace_id: UUID) -> TaskAttempt:
        del workspace_id
        try:
            return self.attempts[attempt_id]
        except KeyError as error:
            raise AttemptNotFoundError from error

    async def create_attempt(self, attempt: TaskAttempt) -> TaskAttempt:
        self.attempt_creations += 1
        self.attempts[attempt.attempt_id] = attempt
        return attempt

    async def transition_attempt(self, attempt_id: UUID, workspace_id: UUID, target: AttemptStatus, *, queued_at: datetime | None = None) -> TaskAttempt:
        del workspace_id
        attempt = self.attempts[attempt_id].model_copy(update={"status": target, "queued_at": queued_at})
        self.attempts[attempt_id] = attempt
        return attempt


def request() -> AgentRunRequest:
    return AgentRunRequest(context=TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="trace-shadow", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read", "project.write"]), budget=RunBudget(max_duration_seconds=30, max_model_calls=4, max_tool_calls=2, max_input_tokens=1000, max_output_tokens=1000, max_departments=2, max_hierarchy_depth=1), model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-5.4-mini"), safety_context=SafetyContextInput(), input=AgentInput(requirement_text="민감한 원문은 payload에 넣지 않습니다."))  # noqa: E501


async def test_shadow_registration_reuses_identical_task_and_attempt_ids() -> None:
    run_request = request()
    spring = RecordingSpringRegistration(run_request)
    registry = MemoryRegistry()
    registrar = PostgresResearchTaskShadowRegistrar(registry, spring)  # type: ignore[arg-type]
    decision = FinalRouteDecision(route=RouteLabel.REACT_AGENT, source=RouteDecisionSource.LLM_EVALUATOR, local_decision=None)

    first = await registrar.register(run_request, decision, SafetyContext(), "workload-token")
    second = await registrar.register(run_request, decision, SafetyContext(), "workload-token")

    assert first.task.task_id == second.task.task_id
    assert first.attempt.attempt_id == second.attempt.attempt_id
    assert registry.task_creations == 1
    assert registry.attempt_creations == 1
    assert spring.payloads[0]["executionProfile"]["permissions"] == ["agent.run", "project.read"]  # type: ignore[index]
    assert "민감한 원문" not in str(spring.payloads[0])
