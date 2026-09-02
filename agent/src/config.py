from functools import lru_cache
from typing import Literal
from uuid import UUID

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "agent"
    service_version: str = "0.1.0"
    environment: str = "development"

    backend_internal_url: str = "http://backend:8080"
    backend_tool_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    model_timeout_seconds: float = Field(default=60.0, gt=0, le=300)
    model_max_attempts: int = Field(default=2, ge=1, le=3)
    gateway_max_concurrency: int = Field(default=2, ge=1, le=32)
    gateway_acquire_timeout_seconds: float = Field(default=2.0, gt=0, le=30)
    gateway_circuit_failure_threshold: int = Field(default=3, ge=1, le=20)
    gateway_circuit_recovery_seconds: float = Field(default=30.0, gt=0, le=600)
    gateway_allowed_models: str = ""
    gateway_metrics_enabled: bool = False
    gateway_metrics_bearer_token: SecretStr | None = Field(default=None, min_length=32)

    langsmith_tracing: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "LANGSMITH_TRACING",
            "LANGSMITH_TRACING_V2",
            "AGENT_LANGSMITH_TRACING",
            "langsmith_tracing"
        )
    )
    langsmith_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "LANGSMITH_API_KEY",
            "LANGCHAIN_API_KEY",
            "AGENT_LANGSMITH_API_KEY",
            "langsmith_api_key"
        )
    )
    langsmith_project: str = Field(
        default="freelance-ops-agent",
        min_length=1,
        max_length=200,
        validation_alias=AliasChoices(
            "LANGSMITH_PROJECT",
            "LANGCHAIN_PROJECT",
            "AGENT_LANGSMITH_PROJECT",
            "langsmith_project"
        )
    )

    event_stream_idle_timeout_seconds: float = Field(default=15.0, gt=0, le=300)

    raptor_build_timeout_seconds: float = Field(default=300.0, gt=0, le=900)

    database_url: str = "postgresql://agent_user:agent_password@localhost:5432/freelance_ops"
    database_pool_min_size: int = Field(default=1, ge=1)
    database_pool_max_size: int = Field(default=5, ge=1)
    database_pool_timeout_seconds: float = Field(default=10.0, gt=0)
    database_pool_open_timeout_seconds: float = Field(default=10.0, gt=0)
    database_pool_max_lifetime_seconds: float = Field(default=1800.0, gt=0)
    database_pool_max_idle_seconds: float = Field(default=300.0, gt=0)

    run_store_backend: Literal["memory", "postgres"] = "memory"

    checkpoint_backend: Literal["memory", "postgres"] = "memory"

    route_evaluator_model: str = "gpt-5.6-luna"
    route_evaluator_reasoning_effort: str = "low"
    route_evaluator_system_prompt: SecretStr | None = None
    route_evaluator_prompt_version: str | None = None
    route_evaluator_prompt_sha256: str | None = None
    route_shadow_enabled: bool = False
    task_shadow_enabled: bool = False
    fifo_dispatcher_enabled: bool = False
    fifo_dispatcher_resource_pool: str = Field(default="research-read-v1", min_length=1, max_length=100)
    fifo_dispatcher_claimed_by: str = Field(default="agent-research-dispatcher", min_length=1, max_length=100)
    fifo_dispatcher_lease_seconds: int = Field(default=60, ge=1, le=300)
    fifo_dispatcher_predicted_runtime_seconds: float = Field(default=30, ge=0, le=3600)
    fifo_dispatcher_predictor_version: str = Field(default="pilot-static-v1", min_length=1, max_length=100)
    fifo_dispatcher_worker_count: int = Field(default=1, ge=1, le=32)
    fifo_dispatcher_workspace_allowlist: str = ""

    delegation_token_issuer: str = "freelance-ops-backend"
    delegation_token_audience: str = "freelance-ops-agent"
    delegation_token_public_key: SecretStr | None = None
    delegation_token_key_id: str = Field(default="freelance-ops-v1", min_length=1, max_length=100)
    delegation_token_previous_key_id: str | None = Field(default=None, min_length=1, max_length=100)
    delegation_token_previous_public_key: SecretStr | None = None
    delegation_token_algorithms: str = "RS256"
    delegation_token_leeway_seconds: int = Field(default=5, ge=0, le=60)

    web_research_enabled: bool = False
    web_research_allowed_domains: str = ""
    web_research_max_results: int = Field(default=5, ge=1, le=20)
    web_research_max_fetches: int = Field(default=3, ge=1, le=10)
    web_research_timeout_seconds: float = Field(default=30.0, gt=0, le=120)
    tavily_api_key: SecretStr | None = Field(default=None, validation_alias=AliasChoices("TAVILY_API_KEY", "AGENT_TAVILY_API_KEY", "tavily_api_key"))  # noqa: E501

    @field_validator(
        "delegation_token_previous_key_id",
        "delegation_token_previous_public_key",
        "langsmith_api_key",
        "gateway_metrics_bearer_token",
        mode="before"
    )
    @classmethod
    def normalize_empty_optional_secret(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None

        return value

    @model_validator(mode="after")
    def validate_database_pool_sizes(self) -> "Settings":
        if self.database_pool_max_size < self.database_pool_min_size:
            raise ValueError("database_pool_max_size must be greater than or equal to database_pool_min_size")

        prompt_values = (
            self.route_evaluator_system_prompt,
            self.route_evaluator_prompt_version,
            self.route_evaluator_prompt_sha256,
        )

        if any(value is not None for value in prompt_values) and not all(value is not None for value in prompt_values):
            raise ValueError("route evaluator prompt secret, version and SHA-256 must be configured together")

        if self.environment == "production" and self.run_store_backend != "postgres":
            raise ValueError("production requires the PostgreSQL Agent run store")

        if self.environment == "production" and self.checkpoint_backend != "postgres":
            raise ValueError("production requires the PostgreSQL LangGraph checkpointer")

        if self.environment == "production" and self.delegation_token_public_key is None:
            raise ValueError("production requires the Spring delegation token public key")

        previous_key_values = (
            self.delegation_token_previous_key_id,
            self.delegation_token_previous_public_key
        )

        if any(value is not None for value in previous_key_values) and not all(value is not None for value in previous_key_values):  # noqa: E501
            raise ValueError("previous delegation key id and public key must be configured together")

        if self.delegation_token_previous_key_id == self.delegation_token_key_id:
            raise ValueError("active and previous delegation key ids must differ")

        if self.environment == "production" and not all(value is not None for value in prompt_values):
            raise ValueError("production requires the pinned private route evaluator prompt")

        if self.web_research_max_fetches > self.web_research_max_results:
            raise ValueError("web_research_max_fetches must not exceed web_research_max_results")

        if self.langsmith_tracing and self.langsmith_api_key is None:
            raise ValueError("enabled LangSmith tracing requires a LangSmith API key")

        if self.gateway_metrics_enabled and self.gateway_metrics_bearer_token is None:
            raise ValueError("enabled gateway metrics require a bearer token")

        if self.web_research_enabled and not self.allowed_web_research_domains():
            raise ValueError("enabled web research requires an explicit domain allowlist")

        if self.web_research_enabled and self.tavily_api_key is None:
            raise ValueError("enabled web research requires a Tavily API key")

        if self.fifo_dispatcher_enabled and (not self.task_shadow_enabled or self.run_store_backend != "postgres" or not self.web_research_enabled):  # noqa: E501
            raise ValueError("enabled FIFO dispatcher requires PostgreSQL Task shadow and web research")

        fifo_workspaces = self.allowed_fifo_dispatcher_workspaces() if self.fifo_dispatcher_enabled else frozenset()
        if self.fifo_dispatcher_enabled and not fifo_workspaces:
            raise ValueError("enabled FIFO dispatcher requires an explicit workspace allowlist")
        if len(fifo_workspaces) > 5:
            raise ValueError("FIFO dispatcher pilot allows at most 5 workspaces")
        if self.fifo_dispatcher_enabled and self.fifo_dispatcher_resource_pool != "research-read-v1":
            raise ValueError("FIFO dispatcher pilot requires the research-read-v1 resource pool")

        return self

    def allowed_web_research_domains(self) -> list[str]:
        return sorted(
            {
                domain.strip().lower().rstrip(".")
                for domain in self.web_research_allowed_domains.split(",")
                if domain.strip()
            }
        )

    def allowed_gateway_models(self) -> frozenset[str]:
        return frozenset(model.strip() for model in self.gateway_allowed_models.split(",") if model.strip())

    def allowed_fifo_dispatcher_workspaces(self) -> frozenset[UUID]:
        try:
            return frozenset(UUID(value.strip()) for value in self.fifo_dispatcher_workspace_allowlist.split(",") if value.strip())  # noqa: E501
        except ValueError as error:
            raise ValueError("FIFO dispatcher workspace allowlist must contain UUIDs") from error

    model_config = SettingsConfigDict(env_prefix="AGENT_", env_file=None, extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
