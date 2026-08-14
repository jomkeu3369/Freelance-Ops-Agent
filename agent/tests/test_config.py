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
