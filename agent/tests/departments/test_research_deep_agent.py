from uuid import uuid4

import pytest
from deepagents.backends import StateBackend

from departments import build_research_deep_agent, research_filesystem_permissions


def test_research_deep_agent_has_no_general_purpose_task_or_shell_backend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-key")

    graph = build_research_deep_agent(
        model="openai:gpt-5.4-mini",
        run_id=uuid4(),
    )
    tool_node = graph.nodes["tools"].bound
    tool_names = set(tool_node._tools_by_name)  # noqa: SLF001 - dependency contract spike

    assert "task" not in tool_names
    assert not hasattr(StateBackend(), "execute")
    assert "execute" in tool_names  # Present in scaffolding, but StateBackend cannot execute host commands.


def test_research_file_permissions_deny_everything_outside_run_namespace() -> None:
    run_id = uuid4()

    rules = research_filesystem_permissions(run_id)

    assert rules[0].mode == "allow"
    assert rules[0].paths == [f"/run/{run_id}", f"/run/{run_id}/**"]
    assert rules[1].mode == "deny"
    assert rules[1].paths == ["/**"]


@pytest.mark.parametrize("model", ["gpt-5.4-mini", "anthropic:claude", ":broken"])
def test_research_deep_agent_rejects_implicit_or_unsupported_provider(model: str) -> None:
    with pytest.raises(ValueError):
        build_research_deep_agent(model=model, run_id=uuid4())
