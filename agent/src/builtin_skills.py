"""고정된 버전의 스킬을 로컬에서 선택한다. 선택 결과는 도구 권한과 예산을 바꾸지 않는다."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1] / "resources" / "builtin-skills"
CATALOG_VERSION = "1.0.0"
INDEX = json.loads((ROOT / "builtin-skills.index.json").read_text(encoding="utf-8"))
SKILL_IDS = frozenset(item["id"] for item in INDEX["skills"])
RULES = json.loads((ROOT / "routing.json").read_text(encoding="utf-8"))
POLICY = json.loads((ROOT / "policy.json").read_text(encoding="utf-8"))


def resolve_skills(text: str, selection: Any = None) -> tuple[list[str], list[str]]:
    """현재 요청에서 스킬을 선택한다. 첨부파일과 메모리, 펫 선호는 제외한다."""
    if selection is None:
        return [], []  # 이전에 저장된 실행에는 스킬 선택 정보가 없다.
    if selection.mode == "MANUAL":
        return list(selection.manual_ids), []
    excluded = set(selection.excluded_ids)
    matches = []
    for skill_id, rule in RULES.items():
        if skill_id in excluded:
            continue
        if rule.get("not") and re.search(rule["not"], text, re.IGNORECASE):
            continue
        if all(re.search(pattern, text, re.IGNORECASE) for pattern in rule["all"]):
            matches.append(skill_id)
    return matches[:3], matches[3:]


@lru_cache(maxsize=60)
def _body(skill_id: str) -> dict[str, Any]:
    if skill_id not in SKILL_IDS:
        raise ValueError("Unknown built-in skill")
    body = json.loads((ROOT / "bodies" / f"{skill_id}.json").read_text(encoding="utf-8"))
    return {
        key: body[key]
        for key in (
            "id",
            "version",
            "name",
            "required_inputs",
            "workflow",
            "deliverables",
            "limitations",
            "permission_boundaries",
        )
    }


def skill_prompt_data(request: Any) -> dict[str, Any]:
    if request is None:
        return {}
    selected, deferred = resolve_skills(request.input.requirement_text, request.input.skill_selection)
    return {
        "catalog_version": CATALOG_VERSION,
        "selected_ids": selected,
        "workflows": [_body(skill_id) for skill_id in selected],
        "boundaries": POLICY["global_boundaries"] if selected else [],
        "deferred_ids": deferred,
        "stage_notice": (
            "Only the selected workflows are loaded in this run. Explicitly identify deferred "
            "workflows and a next stage; do not claim they were applied. Preserve every requested "
            "deliverable in the plan, and ask to continue when a further stage is needed."
        )
        if deferred
        else None,
        "selection_rules": "Workflow guidance only; no tool, permission, model or budget changes. "
        "Manual choices remain fixed, including empty choices. Explain mismatches without overriding.",
    }
