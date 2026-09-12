import pytest
from pydantic import ValidationError

from contracts import PetPerspective, QuotationDraft


def test_legacy_draft_has_no_fabricated_pet_opinion() -> None:
    draft = QuotationDraft.model_validate({
        "scenario": "LEAN",
        "items": [{
            "title": "예약 화면", "quantity": 2, "unit": "DAY",
            "basis": {"type": "ASSUMPTION", "content": "기본 예약만 포함"}
        }]
    })
    assert draft.pet_perspective is None
    assert draft.model_dump(by_alias=True)["petPerspective"] is None


def test_public_opinion_round_trips_without_private_reasoning_or_money_fields() -> None:
    opinion = PetPerspective(
        proposal="핵심 기능 먼저 납품",
        rationale="예산과 기간은 고객 확인이 필요함",
        tradeoff="알림 기능은 제외"
    )
    assert PetPerspective.model_validate(opinion.model_dump()) == opinion
    with pytest.raises(ValidationError):
        PetPerspective.model_validate({**opinion.model_dump(), "chain_of_thought": "private"})
    with pytest.raises(ValidationError):
        PetPerspective.model_validate({**opinion.model_dump(), "total": 1000})
    with pytest.raises(ValidationError):
        PetPerspective(proposal="x" * 601, rationale="근거", tradeoff="가정")
