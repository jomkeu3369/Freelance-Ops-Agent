"""SQLAlchemy ORM persistence for resumable Agent run state."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from contracts import (
    MAX_INTERRUPTION_QUESTIONS,
    AgentInterruption,
    AgentRunEvent,
    AgentRunMetadata,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    AgentRunUsage,
    AgentRunView,
    DepartmentName,
    ResumeAgentRunRequest,
)
from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentRunEventModel, AgentRunStateModel

from .runs import AgentRunNotFoundError, AgentRunStateError, ExecutionOutcome, append_clarification_history, merge_usage


class PostgresAgentRunStore:
    """Persist private runtime state through ORM in the Agent-owned schema only."""

    def __init__(self, database: PgVectorConnectionManager) -> None:
        self._database = database

    async def initialize(self) -> None:
        await self._database.create_runtime_tables()

    async def create(self, request: AgentRunRequest) -> AgentRunView:
        model = AgentRunStateModel(
            run_id=request.context.run_id,
            request_json=request.model_dump(mode="json"),
            status=AgentRunStatus.QUEUED.value,
            idempotency_keys=[],
            updated_at=datetime.now(UTC),
        )
        try:
            async with self._database.session() as session:
                session.add(model)
                await session.flush()
                await self._append_event(session, model.run_id, "run.accepted")
        except IntegrityError as error:
            raise AgentRunStateError("agent run already exists") from error
        return self._view(model)

    async def get(self, run_id: UUID) -> AgentRunView:
        async with self._database.session() as session:
            model = await session.get(AgentRunStateModel, run_id)
            if model is None:
                raise AgentRunNotFoundError("agent run was not found")
            return self._view(model)

    async def get_request(self, run_id: UUID) -> AgentRunRequest:
        async with self._database.session() as session:
            model = await session.get(AgentRunStateModel, run_id)
            if model is None:
                raise AgentRunNotFoundError("agent run was not found")
            return AgentRunRequest.model_validate(model.request_json)

    async def mark_running(self, run_id: UUID) -> None:
        async with self._database.session() as session:
            model = await self._locked(session, run_id)
            if model.status not in {AgentRunStatus.QUEUED.value, AgentRunStatus.WAITING_FOR_USER.value}:
                raise AgentRunStateError("agent run cannot enter RUNNING")
            model.status = AgentRunStatus.RUNNING.value
            model.interruption_json = None
            model.updated_at = datetime.now(UTC)
            await self._append_event(session, run_id, "run.started")

    async def complete(self, run_id: UUID, outcome: ExecutionOutcome) -> None:
        async with self._database.session() as session:
            model = await self._locked(session, run_id)
            if model.status != AgentRunStatus.RUNNING.value:
                raise AgentRunStateError("only a running Agent run can complete")
            model.status = (
                AgentRunStatus.WAITING_FOR_USER.value
                if outcome.interruption is not None
                else AgentRunStatus.PARTIAL.value
                if outcome.partial_error_code is not None
                else AgentRunStatus.COMPLETED.value
            )
            model.active_department = outcome.active_department.value if outcome.active_department is not None else None
            model.interruption_json = self._json(outcome.interruption)
            model.result_json = self._json(outcome.result)
            model.error_code = outcome.partial_error_code
            current_usage = AgentRunUsage.model_validate(model.usage_json) if model.usage_json is not None else None
            model.usage_json = self._json(merge_usage(current_usage, outcome.usage))
            model.updated_at = datetime.now(UTC)
            for event in outcome.events:
                await self._append_event(session, run_id, event.type, event.data)
            if outcome.interruption is not None:
                await self._append_event(
                    session,
                    run_id,
                    "clarification.requested",
                    {"kind": outcome.interruption.kind.value},
                )
            elif outcome.partial_error_code is not None:
                await self._append_event(
                    session,
                    run_id,
                    "run.partial",
                    {"errorCode": outcome.partial_error_code},
                )
            else:
                await self._append_event(session, run_id, "run.completed")

    async def fail(self, run_id: UUID, error_code: str) -> None:
        async with self._database.session() as session:
            model = await self._locked(session, run_id)
            if model.status == AgentRunStatus.CANCELLED.value:
                return
            model.status = AgentRunStatus.FAILED.value
            model.error_code = error_code
            model.updated_at = datetime.now(UTC)
            await self._append_event(session, run_id, "run.failed", {"errorCode": error_code})

    async def cancel(self, run_id: UUID) -> None:
        async with self._database.session() as session:
            model = await self._locked(session, run_id)
            if model.status in {
                AgentRunStatus.COMPLETED.value,
                AgentRunStatus.PARTIAL.value,
                AgentRunStatus.FAILED.value,
                AgentRunStatus.CANCELLED.value,
            }:
                raise AgentRunStateError("terminal Agent run cannot be cancelled")
            model.status = AgentRunStatus.CANCELLED.value
            model.updated_at = datetime.now(UTC)
            await self._append_event(session, run_id, "run.cancelled")

    async def list_events(self, run_id: UUID, after_event_id: int = 0) -> list[AgentRunEvent]:
        async with self._database.session() as session:
            if await session.get(AgentRunStateModel, run_id) is None:
                raise AgentRunNotFoundError("agent run was not found")
            statement = (
                select(AgentRunEventModel)
                .where(
                    AgentRunEventModel.run_id == run_id,
                    AgentRunEventModel.event_id > after_event_id,
                )
                .order_by(AgentRunEventModel.event_id)
            )
            models = list((await session.scalars(statement)).all())
        return [self._event(model) for model in models]

    async def prepare_resume(self, run_id: UUID, command: ResumeAgentRunRequest) -> AgentRunRequest:
        async with self._database.session() as session:
            model = await self._locked(session, run_id)
            view = self._view(model)
            if view.status is not AgentRunStatus.WAITING_FOR_USER or view.interruption is None:
                raise AgentRunStateError("agent run is not waiting for user input")
            if view.interruption.interruption_id != command.interruption_id:
                raise AgentRunStateError("interruption id does not match the active interruption")
            keys = self._string_set(model.idempotency_keys)
            if command.idempotency_key in keys:
                raise AgentRunStateError("resume idempotency key was already used")
            indices = [answer.question_index for answer in command.answers]
            if len(indices) != len(set(indices)) or any(index >= len(view.interruption.questions) for index in indices):
                raise AgentRunStateError("resume answers do not match active questions")
            keys.add(command.idempotency_key)
            model.idempotency_keys = sorted(keys)
            request = append_clarification_history(
                AgentRunRequest.model_validate(model.request_json),
                view.interruption,
                command
            )
            model.request_json = request.model_dump(mode="json")
            await self._append_event(session, run_id, "clarification.responded")
            return request

    @staticmethod
    async def _locked(session: AsyncSession, run_id: UUID) -> AgentRunStateModel:
        # 상태 전이는 동일 run row를 잠가 취소·완료·재개 간 경합을 직렬화한다.
        statement = select(AgentRunStateModel).where(AgentRunStateModel.run_id == run_id).with_for_update()
        model = await session.scalar(statement)
        if model is None:
            raise AgentRunNotFoundError("agent run was not found")
        return model

    @staticmethod
    async def _append_event(session: AsyncSession, run_id: UUID, event_type: str, data: dict[str, object] | None = None) -> None:  # noqa: E501
        statement = select(func.coalesce(func.max(AgentRunEventModel.event_id), 0)).where(
            AgentRunEventModel.run_id == run_id
        )
        event_id = int((await session.scalar(statement)) or 0) + 1
        session.add(
            AgentRunEventModel(
                run_id=run_id,
                event_id=event_id,
                type=event_type,
                data_json=data or {},
                occurred_at=datetime.now(UTC),
            )
        )
        await session.flush()

    @staticmethod
    def _view(model: AgentRunStateModel) -> AgentRunView:
        request = AgentRunRequest.model_validate(model.request_json)
        return AgentRunView(
            run_id=model.run_id,
            status=AgentRunStatus(model.status),
            active_department=DepartmentName(model.active_department) if model.active_department is not None else None,
            interruption=(
                PostgresAgentRunStore._stored_interruption(model.interruption_json)
                if model.interruption_json is not None
                else None
            ),
            result=AgentRunResult.model_validate(model.result_json) if model.result_json is not None else None,
            error_code=model.error_code,
            metadata=AgentRunMetadata(
                provider=request.model_selection.provider,
                model=request.model_selection.model,
                prompt_version="department-work-product-v1",
                tool_schema_version="spring-tool-api-v0.2.0",
                trace_id=request.context.trace_id,
            ),
            usage=AgentRunUsage.model_validate(model.usage_json) if model.usage_json is not None else None,
            updated_at=model.updated_at,
        )

    @staticmethod
    def _event(model: AgentRunEventModel) -> AgentRunEvent:
        return AgentRunEvent(
            event_id=model.event_id,
            run_id=model.run_id,
            type=model.type,
            occurred_at=model.occurred_at,
            data=model.data_json,
        )

    @staticmethod
    def _json(value: AgentInterruption | AgentRunResult | AgentRunUsage | None) -> dict[str, object] | None:
        return value.model_dump(mode="json") if value is not None else None

    @staticmethod
    def _stored_interruption(value: dict[str, object]) -> AgentInterruption:
        questions = value.get("questions")
        if not isinstance(questions, list) or len(questions) <= MAX_INTERRUPTION_QUESTIONS:
            return AgentInterruption.model_validate(value)
        return AgentInterruption.model_validate(
            {**value, "questions": questions[:MAX_INTERRUPTION_QUESTIONS]}
        )

    @staticmethod
    def _string_set(value: object) -> set[str]:
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise AgentRunStateError("stored idempotency keys are invalid")
        return set(value)
