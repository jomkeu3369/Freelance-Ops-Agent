from sqlalchemy import Select, select

from infrastructure.database.models import AgentRunEventModel, AgentRunStateModel


def test_runtime_models_are_confined_to_agent_schema() -> None:
    assert AgentRunStateModel.__table__.schema == "agent_runtime"
    assert AgentRunEventModel.__table__.schema == "agent_runtime"


def test_run_queries_are_sqlalchemy_expressions() -> None:
    statement = select(AgentRunStateModel).where(AgentRunStateModel.status == "QUEUED")

    assert isinstance(statement, Select)
