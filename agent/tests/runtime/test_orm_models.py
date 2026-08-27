from sqlalchemy import Select, select

from infrastructure.database.models import AgentRunEventModel, AgentRunStateModel, AgentTaskEventModel


def test_runtime_models_are_confined_to_agent_schema() -> None:
    assert AgentRunStateModel.__table__.schema == "agent_runtime"
    assert AgentRunEventModel.__table__.schema == "agent_runtime"
    assert AgentTaskEventModel.__table__.schema == "agent_runtime"


def test_task_event_model_has_idempotency_constraints() -> None:
    constraint_names = {constraint.name for constraint in AgentTaskEventModel.__table__.constraints}

    assert "uq_agent_task_event_source" in constraint_names
    assert "uq_agent_task_event_attempt_sequence" in constraint_names


def test_run_queries_are_sqlalchemy_expressions() -> None:
    statement = select(AgentRunStateModel).where(AgentRunStateModel.status == "QUEUED")

    assert isinstance(statement, Select)
