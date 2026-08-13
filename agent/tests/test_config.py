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
