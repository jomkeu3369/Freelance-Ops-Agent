import json
from pathlib import Path

import pytest

from runtime.conversation_text import conversation_text

_CASES = json.loads(
    (Path(__file__).resolve().parents[3] / "contracts/fixtures/pet-conversation-text.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("sample", _CASES)
def test_monetary_claims_are_removed_but_effort_and_requirements_are_preserved(sample: dict[str, str]) -> None:
    assert conversation_text(sample["text"]) == sample["expected"]
