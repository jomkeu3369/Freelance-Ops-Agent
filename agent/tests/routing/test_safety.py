from routing import SafetyContext, SafetyDecisionCode, evaluate_safety


def test_safe_read_only_request_continues_to_llm() -> None:
    decision = evaluate_safety(SafetyContext())

    assert not decision.requires_human
    assert decision.code is SafetyDecisionCode.CONTINUE_TO_LLM


def test_unverified_external_action_requires_human() -> None:
    decision = evaluate_safety(SafetyContext(external_side_effect=True))

    assert decision.requires_human
    assert decision.code is SafetyDecisionCode.AUTHORITY_NOT_VERIFIED


def test_sensitive_external_transfer_requires_human_even_with_authority() -> None:
    decision = evaluate_safety(
        SafetyContext(
            external_side_effect=True,
            sensitive_data=True,
            authority_verified=True,
        )
    )

    assert decision.requires_human
    assert decision.code is SafetyDecisionCode.SENSITIVE_DATA_REVIEW_REQUIRED


def test_irreversible_action_requires_approval() -> None:
    decision = evaluate_safety(
        SafetyContext(irreversible_action=True, authority_verified=True)
    )

    assert decision.requires_human
    assert decision.code is SafetyDecisionCode.APPROVAL_REQUIRED
