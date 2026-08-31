from routing import ExecutionRisk, RouteLabel, SafetyContext, ToolProfile, execution_profile


def test_supervisor_profile_is_medium_risk_and_read_only_by_default() -> None:
    profile = execution_profile(RouteLabel.SUPERVISOR, SafetyContext())

    assert profile.risk is ExecutionRisk.MEDIUM
    assert profile.tool_profile is ToolProfile.READ_ONLY
    assert profile.model_profile == "supervisor-v1"


def test_irreversible_profile_is_restricted_even_when_route_is_automatic() -> None:
    profile = execution_profile(RouteLabel.REACT_AGENT, SafetyContext(irreversible_action=True))

    assert profile.risk is ExecutionRisk.RESTRICTED
    assert profile.tool_profile is ToolProfile.NONE
