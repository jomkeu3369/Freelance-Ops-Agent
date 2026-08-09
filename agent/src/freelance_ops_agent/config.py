from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "agent"
    service_version: str = "0.1.0"
    environment: str = "development"
    backend_internal_url: str = "http://backend:8080"
    database_url: str = "postgresql://agent_user:agent_password@localhost:5432/freelance_ops"

    model_config = SettingsConfigDict(env_prefix="AGENT_", env_file=None, extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()

