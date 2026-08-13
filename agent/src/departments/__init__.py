"""Department-level Agent execution harnesses."""

from .research_deep_agent import (
    ResearchOutput,
    build_research_deep_agent,
    research_filesystem_permissions,
)

__all__ = ["ResearchOutput", "build_research_deep_agent", "research_filesystem_permissions"]
