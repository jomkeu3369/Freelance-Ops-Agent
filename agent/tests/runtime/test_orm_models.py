# ruff: noqa: E501, I001

from sqlalchemy import Select, select

from infrastructure.database.models import AgentProviderCircuitModel, AgentRetryBucketModel, AgentRunEventModel, AgentRunStateModel, AgentSchedulerEntryModel, AgentTaskAttemptModel, AgentTaskEventModel, AgentTaskModel, AgentWorkerCapacityEventModel


def test_runtime_models_are_confined_to_agent_schema() -> None:
    assert AgentRunStateModel.__table__.schema == "agent_runtime"
    assert AgentRunEventModel.__table__.schema == "agent_runtime"
    assert AgentTaskEventModel.__table__.schema == "agent_runtime"
    assert AgentTaskModel.__table__.schema == "agent_runtime"
    assert AgentTaskAttemptModel.__table__.schema == "agent_runtime"
    assert AgentRetryBucketModel.__table__.schema == "agent_runtime"
    assert AgentProviderCircuitModel.__table__.schema == "agent_runtime"
    assert AgentSchedulerEntryModel.__table__.schema == "agent_runtime"
    assert AgentWorkerCapacityEventModel.__table__.schema == "agent_runtime"


def test_task_event_model_has_idempotency_constraints() -> None:
    constraint_names = {constraint.name for constraint in AgentTaskEventModel.__table__.constraints}

    assert "uq_agent_task_event_source" in constraint_names
    assert "uq_agent_task_event_attempt_sequence" in constraint_names
    assert "task_revision" in AgentTaskEventModel.__table__.columns
    assert "delivery_status" in AgentTaskEventModel.__table__.columns


def test_run_queries_are_sqlalchemy_expressions() -> None:
    statement = select(AgentRunStateModel).where(AgentRunStateModel.status == "QUEUED")

    assert isinstance(statement, Select)


def test_task_registry_models_have_revision_and_attempt_constraints() -> None:
    task_primary_keys = {column.name for column in AgentTaskModel.__table__.primary_key.columns}
    task_constraints = {constraint.name for constraint in AgentTaskModel.__table__.constraints}
    attempt_constraints = {constraint.name for constraint in AgentTaskAttemptModel.__table__.constraints}

    assert task_primary_keys == {"task_id", "revision"}
    assert "ck_agent_task_status" in task_constraints
    assert "uq_agent_task_attempt_number" in attempt_constraints
    assert "ck_agent_task_attempt_status" in attempt_constraints
    assert "ck_agent_task_attempt_prediction_pair" in attempt_constraints
    assert "ck_agent_task_attempt_time_order" in attempt_constraints
    assert "ck_agent_task_attempt_checkpoint_pair" in attempt_constraints
    assert "ck_agent_task_attempt_retry_decision" in attempt_constraints


def test_scheduler_models_preserve_fifo_claim_and_shadow_policy_state() -> None:
    entry_constraints = {constraint.name for constraint in AgentSchedulerEntryModel.__table__.constraints}

    assert "ck_agent_scheduler_entry_claim" in entry_constraints
    assert "actual_policy_version" in AgentSchedulerEntryModel.__table__.columns
    assert "shadow_policy_version" in AgentSchedulerEntryModel.__table__.columns
    assert "admission_snapshot" in AgentSchedulerEntryModel.__table__.columns
