from uuid import uuid4

import pytest
from pydantic import ValidationError

from config import Settings


def test_production_fails_closed_without_durable_backends_and_security_secrets() -> None:
    with pytest.raises(ValidationError, match="PostgreSQL Agent run store"):
        Settings(environment="production")

    with pytest.raises(ValidationError, match="delegation token public key"):
        Settings(
            environment="production",
            run_store_backend="postgres",
            checkpoint_backend="postgres",
            route_evaluator_system_prompt="private",
            route_evaluator_prompt_version="v1",
            route_evaluator_prompt_sha256="a" * 64,
        )


def test_production_accepts_only_complete_security_configuration() -> None:
    settings = Settings(
        environment="production",
        run_store_backend="postgres",
        checkpoint_backend="postgres",
        delegation_token_public_key="public-key",
        route_evaluator_system_prompt="private",
        route_evaluator_prompt_version="v1",
        route_evaluator_prompt_sha256="a" * 64,
    )

    assert settings.run_store_backend == "postgres"
    assert settings.checkpoint_backend == "postgres"


def test_enabled_web_research_requires_allowlist_and_api_key() -> None:
    with pytest.raises(ValidationError, match="domain allowlist"):
        Settings(web_research_enabled=True, tavily_api_key="secret")
    with pytest.raises(ValidationError, match="Tavily API key"):
        Settings(web_research_enabled=True, web_research_allowed_domains="example.go.kr")

    settings = Settings(
        web_research_enabled=True,
        web_research_allowed_domains=" example.go.kr,WWW.EXAMPLE.GO.KR,example.go.kr ",
        tavily_api_key="secret"
    )

    assert settings.allowed_web_research_domains() == ["example.go.kr", "www.example.go.kr"]


def test_fifo_dispatcher_is_default_off_and_requires_bounded_runtime_dependencies() -> None:
    assert not Settings().fifo_dispatcher_enabled
    with pytest.raises(ValidationError, match="FIFO dispatcher"):
        Settings(fifo_dispatcher_enabled=True)

    workspace_id = uuid4()
    settings = Settings(fifo_dispatcher_enabled=True, fifo_dispatcher_workspace_allowlist=str(workspace_id), task_shadow_enabled=True, run_store_backend="postgres", web_research_enabled=True, web_research_allowed_domains="example.gov", tavily_api_key="test-key", fifo_dispatcher_readiness_path="readiness.json", fifo_dispatcher_readiness_sha256="a" * 64, fifo_dispatcher_deployment_commit_sha="b" * 40)  # noqa: E501

    assert settings.fifo_dispatcher_resource_pool == "research-read-v1"
    assert settings.fifo_dispatcher_predictor_version == "pilot-static-v1"
    assert settings.allowed_fifo_dispatcher_workspaces() == {workspace_id}

    with pytest.raises(ValidationError, match="pinned readiness evidence"):
        Settings(fifo_dispatcher_enabled=True, fifo_dispatcher_workspace_allowlist=str(workspace_id), task_shadow_enabled=True, run_store_backend="postgres", web_research_enabled=True, web_research_allowed_domains="example.gov", tavily_api_key="test-key")  # noqa: E501

    with pytest.raises(ValidationError, match="workspace allowlist"):
        Settings(fifo_dispatcher_enabled=True, task_shadow_enabled=True, run_store_backend="postgres", web_research_enabled=True, web_research_allowed_domains="example.gov", tavily_api_key="test-key")  # noqa: E501
    with pytest.raises(ValidationError, match="UUIDs"):
        Settings(fifo_dispatcher_enabled=True, fifo_dispatcher_workspace_allowlist="not-a-uuid", task_shadow_enabled=True, run_store_backend="postgres", web_research_enabled=True, web_research_allowed_domains="example.gov", tavily_api_key="test-key")  # noqa: E501
    with pytest.raises(ValidationError, match="at most 5"):
        Settings(fifo_dispatcher_enabled=True, fifo_dispatcher_workspace_allowlist=",".join(str(uuid4()) for _ in range(6)), task_shadow_enabled=True, run_store_backend="postgres", web_research_enabled=True, web_research_allowed_domains="example.gov", tavily_api_key="test-key")  # noqa: E501
    with pytest.raises(ValidationError, match="research-read-v1"):
        Settings(fifo_dispatcher_enabled=True, fifo_dispatcher_workspace_allowlist=str(workspace_id), fifo_dispatcher_resource_pool="general", task_shadow_enabled=True, run_store_backend="postgres", web_research_enabled=True, web_research_allowed_domains="example.gov", tavily_api_key="test-key")  # noqa: E501


def test_delegation_rotation_requires_complete_distinct_previous_key() -> None:
    with pytest.raises(ValidationError, match="configured together"):
        Settings(delegation_token_previous_key_id="previous-v1")
    with pytest.raises(ValidationError, match="must differ"):
        Settings(
            delegation_token_key_id="active-v2",
            delegation_token_previous_key_id="active-v2",
            delegation_token_previous_public_key="public-key"
        )


def test_blank_previous_delegation_key_values_are_treated_as_unset() -> None:
    settings = Settings(
        delegation_token_previous_key_id="",
        delegation_token_previous_public_key=""
    )

    assert settings.delegation_token_previous_key_id is None
    assert settings.delegation_token_previous_public_key is None


def test_enabled_langsmith_tracing_requires_a_non_empty_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValidationError, match="LangSmith API key"):
        Settings(langsmith_tracing=True, langsmith_api_key="")

    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2_test_secret")
    monkeypatch.setenv("LANGSMITH_PROJECT", "freelance-ops-agent-test")
    settings = Settings()

    assert settings.langsmith_tracing is True
    assert settings.langsmith_project == "freelance-ops-agent-test"


def test_gateway_metrics_are_disabled_by_default_and_require_a_token() -> None:
    assert Settings().gateway_metrics_enabled is False

    with pytest.raises(ValidationError, match="metrics require a bearer token"):
        Settings(gateway_metrics_enabled=True, gateway_metrics_bearer_token="")

    metrics_secret = "metrics-secret-with-at-least-32-bytes"
    settings = Settings(gateway_metrics_enabled=True, gateway_metrics_bearer_token=metrics_secret)

    assert settings.gateway_metrics_bearer_token is not None
    assert settings.gateway_metrics_bearer_token.get_secret_value() == metrics_secret
