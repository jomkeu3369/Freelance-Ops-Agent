import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from builtin_skills import ROOT, SKILL_IDS, resolve_skills, skill_prompt_data
from contracts import AgentInput, AgentRunRequest, SkillSelection

CASES = json.loads((ROOT / "acceptance-cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", [c for c in CASES if c["kind"] == "routing"], ids=lambda c: c["id"])
def test_actual_offline_router_matches_catalog_acceptance(case: dict) -> None:
    selected, deferred = resolve_skills(case["prompt"], SkillSelection())
    assert next(iter(selected), None) == case["expected_primary"]
    assert not set(selected).intersection(case["must_not_select"])
    assert set(selected[1:]).issubset(case["allowed_supporting"])
    assert len(selected) <= case["max_selected"]
    assert not deferred


def test_bounded_stages_expose_all_requested_workflows() -> None:
    case = next(c for c in CASES if c["kind"] == "staging")
    selected, deferred = resolve_skills(case["prompt"], SkillSelection())
    assert len(selected) == 3
    assert set(selected + deferred) == set(case["required_across_stages"])
    request = AgentRunRequest.model_construct(input=AgentInput(requirement_text=case["prompt"], skill_selection=SkillSelection()))
    data = skill_prompt_data(request)
    assert len(data["workflows"]) == 3
    assert data["deferred_ids"] == ["ops-milestone-plan"]
    assert "do not claim they were applied" in data["stage_notice"]


@pytest.mark.parametrize("values", [
    {"manualIds": ["../../secrets"]}, {"manualIds": ["writing-proposal"] * 2},
    {"manualIds": list(SKILL_IDS)[:4]}, {"catalogVersion": "latest"}, {"tools": ["admin"]},
    {"excludedIds": ["unknown"]}, {"mode": "MAGIC"},
])
def test_selection_rejects_unknown_versions_ids_duplicates_and_authority(values: dict) -> None:
    with pytest.raises(ValidationError):
        SkillSelection.model_validate(values)


def test_manual_empty_override_exclusions_and_legacy_metadata() -> None:
    text = "Prepare a proposal"
    assert resolve_skills(text, SkillSelection(mode="MANUAL")) == ([], [])
    assert resolve_skills(text, SkillSelection(mode="MANUAL", manual_ids=["research-data-cleaning"])) == (["research-data-cleaning"], [])
    assert resolve_skills(text, SkillSelection(excluded_ids=["writing-proposal"])) == ([], [])
    assert resolve_skills(text, None) == ([], [])


def test_only_selected_bodies_load_and_all_boundaries_survive() -> None:
    request = AgentRunRequest.model_construct(input=AgentInput(requirement_text="Prepare a proposal", skill_selection=SkillSelection()))
    data = skill_prompt_data(request)
    assert data["selected_ids"] == ["writing-proposal"]
    assert len(data["workflows"]) == 1
    assert data["workflows"][0]["permission_boundaries"]
    assert data["boundaries"]
    assert "design-creative-brief" not in json.dumps(data)
    assert len(SKILL_IDS) == 60
    frontend = Path(__file__).resolve().parents[2] / "frontend/features/workspace/skills"
    assert json.loads((frontend / "routing.json").read_text()) == json.loads((ROOT / "routing.json").read_text())
    assert json.loads((frontend / "catalog.json").read_text()) == json.loads((ROOT / "builtin-skills.index.json").read_text())
