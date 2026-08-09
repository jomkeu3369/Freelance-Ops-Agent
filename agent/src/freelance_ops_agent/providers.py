from typing import Protocol

from freelance_ops_agent.contracts import ModelSelection


class ModelProvider(Protocol):
    async def generate_structured(self, selection: ModelSelection, prompt: str) -> dict[str, object]: ...


class ProviderNotConfiguredError(RuntimeError):
    """Raised when a requested model provider has not been configured."""

