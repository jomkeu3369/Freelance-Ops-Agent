"""Transactional checkpoint and retry decisions for Task attempts."""

# ruff: noqa: E501, I001

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.database import PgVectorConnectionManager
from infrastructure.database.models import AgentProviderCircuitModel, AgentRetryBucketModel, AgentTaskAttemptModel, AgentTaskEventModel, AgentTaskModel

from .reliability import FAILURE_CLASSIFIER_VERSION, RETRY_BUCKET_POLICY_VERSION, CircuitState, FailureAssessment, HierarchicalRetryBudget, ProviderCircuit, ProviderCircuitPolicy, TokenBucketState, WeightedFailureClassifier, default_retry_buckets
from .task_contracts import AttemptStatus, FailureSignals, RetryDecision, RetryDecisionSnapshot, TaskCheckpoint, TaskRevisionConflictError, TaskStatus, ensure_attempt_transition, ensure_task_transition, ensure_workspace_scope


class TaskReliabilityError(RuntimeError):
    pass


class PostgresTaskReliabilityStore:
    def __init__(self, database: PgVectorConnectionManager, *, classifier: WeightedFailureClassifier | None = None, retry_budget: HierarchicalRetryBudget | None = None, circuit_policy: ProviderCircuitPolicy | None = None) -> None:
        self._database = database
        self._classifier = classifier or WeightedFailureClassifier()
        self._retry_budget = retry_budget or HierarchicalRetryBudget()
        self._circuit_policy = circuit_policy or ProviderCircuitPolicy()

    async def checkpoint(self, attempt_id: UUID, workspace_id: UUID, checkpoint: TaskCheckpoint, *, source: str, source_event_id: str, sequence: int) -> dict[str, object]:
        if not source.strip() or not source_event_id.strip() or sequence < 1:
            raise ValueError("checkpoint event identity is invalid")
        now = datetime.now(UTC)
        async with self._database.session() as session:
            attempt = await session.scalar(select(AgentTaskAttemptModel).where(AgentTaskAttemptModel.attempt_id == attempt_id).with_for_update())
            if attempt is None:
                raise TaskReliabilityError("task attempt was not found")
            ensure_workspace_scope(workspace_id, attempt.workspace_id)
            task = await session.scalar(select(AgentTaskModel).where(AgentTaskModel.task_id == attempt.task_id, AgentTaskModel.revision == attempt.task_revision).with_for_update())
            if task is None or task.run_id != attempt.run_id:
                raise TaskRevisionConflictError("checkpoint task identity is invalid")
            if attempt.checkpoint_id is not None:
                if attempt.checkpoint_id == checkpoint.checkpoint_id and attempt.resume_token_hash == checkpoint.resume_token_hash:
                    return self._checkpoint_public_data(attempt)
                raise TaskReliabilityError("attempt already has a different checkpoint")
            ensure_attempt_transition(AttemptStatus(attempt.status), AttemptStatus.CHECKPOINTED)
            ensure_task_transition(TaskStatus(task.status), TaskStatus.CHECKPOINTED)
            attempt.status = AttemptStatus.CHECKPOINTED.value
            attempt.checkpoint_id = checkpoint.checkpoint_id
            attempt.checkpoint_artifact_reference = checkpoint.artifact_reference
            attempt.resume_token_hash = checkpoint.resume_token_hash
            attempt.checkpoint_restored_seconds = checkpoint.durable_progress_seconds
            attempt.completed_steps = list(checkpoint.completed_steps)
            attempt.side_effect_idempotency_keys = list(checkpoint.side_effect_idempotency_keys)
            attempt.updated_at = now
            task.status = TaskStatus.CHECKPOINTED.value
            task.updated_at = now
            data = self._checkpoint_public_data(attempt)
            session.add(self._event(attempt, event_type="attempt.checkpointed", source=source, source_event_id=source_event_id, sequence=sequence, occurred_at=checkpoint.created_at, received_at=now, data=data))
            await session.flush()
            return data

    async def decide_retry(self, attempt_id: UUID, workspace_id: UUID, signals: FailureSignals, *, max_attempts: int, backoff_seconds: float = 0, source: str = "failure-classifier-v1") -> RetryDecisionSnapshot:
        if max_attempts < 1 or backoff_seconds < 0 or not source.strip():
            raise ValueError("retry decision options are invalid")
        now = datetime.now(UTC)
        async with self._database.session() as session:
            attempt = await session.scalar(select(AgentTaskAttemptModel).where(AgentTaskAttemptModel.attempt_id == attempt_id).with_for_update())
            if attempt is None:
                raise TaskReliabilityError("task attempt was not found")
            ensure_workspace_scope(workspace_id, attempt.workspace_id)
            if AttemptStatus(attempt.status) is not AttemptStatus.FAILED:
                raise TaskReliabilityError("retry decision requires a failed attempt")
            if attempt.retry_snapshot is not None:
                return RetryDecisionSnapshot.model_validate(attempt.retry_snapshot)
            task = await session.scalar(select(AgentTaskModel).where(AgentTaskModel.task_id == attempt.task_id, AgentTaskModel.revision == attempt.task_revision).with_for_update())
            if task is None:
                raise TaskRevisionConflictError("retry task identity is invalid")
            workspace_model, global_model = await self._locked_buckets(session, workspace_id, now)
            assessment = self._classifier.classify(signals)
            snapshot, workspace_after, global_after = self._retry_budget.decide(assessment, self._bucket(workspace_model), self._bucket(global_model), attempt_number=attempt.attempt_number, max_attempts=max_attempts, now=now, backoff_seconds=backoff_seconds)
            if snapshot.decision is RetryDecision.ALLOW:
                self._apply_bucket(workspace_model, workspace_after)
                self._apply_bucket(global_model, global_after)
            attempt.failure_classification = snapshot.failure_classification.value
            attempt.classification_confidence = snapshot.classification_confidence
            attempt.classifier_version = snapshot.classifier_version
            attempt.retry_decision = snapshot.decision.value
            attempt.retry_reason = snapshot.reason.value
            attempt.retry_ready_at = snapshot.retry_ready_at
            attempt.retry_snapshot = snapshot.model_dump(mode="json", exclude_none=True)
            attempt.updated_at = now
            target = TaskStatus.RETRY_WAIT if snapshot.decision is RetryDecision.ALLOW else TaskStatus.FAILED
            ensure_task_transition(TaskStatus(task.status), target)
            task.status = target.value
            task.updated_at = now
            if snapshot.failure_classification.value == "CORRELATED_PROVIDER":
                await self._open_circuit(session, task, assessment, now)
            sequence = int(await session.scalar(select(func.coalesce(func.max(AgentTaskEventModel.sequence), 0)).where(AgentTaskEventModel.attempt_id == attempt_id))) + 1
            data = snapshot.model_dump(mode="json", exclude_none=True)
            session.add(self._event(attempt, event_type="attempt.retry_decided", source=source, source_event_id=f"{attempt_id}:{sequence}", sequence=sequence, occurred_at=now, received_at=now, data=data))
            await session.flush()
            return snapshot

    async def _locked_buckets(self, session: AsyncSession, workspace_id: UUID, now: datetime) -> tuple[AgentRetryBucketModel, AgentRetryBucketModel]:
        workspace_key = f"workspace:{workspace_id}"
        workspace = await session.get(AgentRetryBucketModel, workspace_key, with_for_update=True)
        global_bucket = await session.get(AgentRetryBucketModel, "global", with_for_update=True)
        workspace_default, global_default = default_retry_buckets(now)
        if workspace is None:
            workspace = AgentRetryBucketModel(bucket_key=workspace_key, scope_type="WORKSPACE", workspace_id=workspace_id, capacity=workspace_default.capacity, tokens=workspace_default.tokens, refill_per_second=workspace_default.refill_per_second, refilled_at=now, policy_version=RETRY_BUCKET_POLICY_VERSION)
            session.add(workspace)
        if global_bucket is None:
            global_bucket = AgentRetryBucketModel(bucket_key="global", scope_type="GLOBAL", workspace_id=None, capacity=global_default.capacity, tokens=global_default.tokens, refill_per_second=global_default.refill_per_second, refilled_at=now, policy_version=RETRY_BUCKET_POLICY_VERSION)
            session.add(global_bucket)
        return workspace, global_bucket

    async def _open_circuit(self, session: AsyncSession, task: AgentTaskModel, assessment: FailureAssessment, now: datetime) -> None:
        selection = dict(task.execution_json.get("model_selection", task.execution_json.get("modelSelection", {})))
        provider = str(selection.get("provider", "UNKNOWN"))
        model = str(selection.get("model", "unknown"))
        key = f"{provider}:{model}"
        stored = await session.get(AgentProviderCircuitModel, key, with_for_update=True)
        current = ProviderCircuit() if stored is None else ProviderCircuit(CircuitState(stored.state), stored.opened_at, stored.probe_after)
        updated = self._circuit_policy.observe(current, assessment, now)
        if stored is None:
            session.add(AgentProviderCircuitModel(circuit_key=key, provider=provider, model=model, state=updated.state.value, opened_at=updated.opened_at, probe_after=updated.probe_after, policy_version=FAILURE_CLASSIFIER_VERSION, updated_at=now))
        else:
            stored.state = updated.state.value
            stored.opened_at = updated.opened_at
            stored.probe_after = updated.probe_after
            stored.updated_at = now

    @staticmethod
    def _checkpoint_public_data(attempt: AgentTaskAttemptModel) -> dict[str, object]:
        return {"checkpoint_id": str(attempt.checkpoint_id), "checkpoint_artifact_reference": str(attempt.checkpoint_artifact_reference), "checkpoint_restored_seconds": attempt.checkpoint_restored_seconds, "completed_steps": list(attempt.completed_steps), "side_effect_idempotency_keys": list(attempt.side_effect_idempotency_keys)}

    @staticmethod
    def _bucket(model: AgentRetryBucketModel) -> TokenBucketState:
        return TokenBucketState(model.capacity, model.tokens, model.refill_per_second, model.refilled_at)

    @staticmethod
    def _apply_bucket(model: AgentRetryBucketModel, state: TokenBucketState) -> None:
        model.tokens = state.tokens
        model.refilled_at = state.refilled_at

    @staticmethod
    def _event(attempt: AgentTaskAttemptModel, *, event_type: str, source: str, source_event_id: str, sequence: int, occurred_at: datetime, received_at: datetime, data: dict[str, object]) -> AgentTaskEventModel:
        return AgentTaskEventModel(event_id=f"{attempt.attempt_id}:{sequence}:{event_type}", run_id=attempt.run_id, schema_version="task-attempt-telemetry-v1", source=source, source_event_id=source_event_id, task_id=attempt.task_id, task_revision=attempt.task_revision, attempt_id=attempt.attempt_id, attempt_number=attempt.attempt_number, workspace_id=attempt.workspace_id, sequence=sequence, event_type=event_type, phase="RELIABILITY", milestone=event_type, occurred_at=occurred_at, received_at=received_at, data_json=data, delivery_status="PENDING", delivery_attempts=0, delivery_available_at=received_at)
