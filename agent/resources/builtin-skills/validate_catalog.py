#!/usr/bin/env python3
"""카탈로그 구조와 검증 데이터를 검사하고 요청한 경로에 보고서를 저장한다."""

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent


def validate_catalog(bundle_path: Path = ROOT) -> dict[str, Any]:
    """검증 결과를 반환한다. 원본 자료와 기존 보고서는 변경하지 않는다."""
    catalog = json.loads((bundle_path / "builtin-skills.catalog.json").read_text(encoding="utf-8"))
    schema = json.loads((bundle_path / "builtin-skills.schema.json").read_text(encoding="utf-8"))
    index = json.loads((bundle_path / "builtin-skills.index.json").read_text(encoding="utf-8"))
    acceptance_fixtures = json.loads((bundle_path / "acceptance-cases.json").read_text(encoding="utf-8"))
    checks: list[dict[str, str | bool]] = []

    def check(name: str, condition: object) -> None:
        checks.append({"name": name, "passed": bool(condition)})
        if not condition:
            raise AssertionError(name)

    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(catalog),
        key=lambda error: str(error.path)
    )
    check("json_schema_valid", not errors)
    skills = catalog["skills"]
    skill_ids = [skill["id"] for skill in skills]
    known_skill_ids = set(skill_ids)
    check("exactly_60_skills", len(skills) == catalog["skill_count"] == 60)
    check("unique_stable_ids", len(known_skill_ids) == 60)
    check("unique_korean_names", len({skill["name"]["ko"] for skill in skills}) == 60)
    check("unique_english_names", len({skill["name"]["en"] for skill in skills}) == 60)
    check(
        "localized_names_and_summaries",
        all(
            re.search("[가-힣]", skill["name"]["ko"])
            and re.search("[가-힣]", skill["summary"]["ko"])
            and re.search("[a-zA-Z]", skill["name"]["en"])
            for skill in skills
        )
    )
    check("unique_category_ids", len({entry["id"] for entry in catalog["categories"]}) == 8)
    expected_category_counts = {entry["id"]: entry["expected_count"] for entry in catalog["categories"]}
    check("category_counts_match", dict(Counter(skill["category"] for skill in skills)) == expected_category_counts)
    check(
        "workflow_steps_sequential",
        all(
            [item["step"] for item in skill["workflow"]] == list(range(1, len(skill["workflow"]) + 1))
            for skill in skills
        )
    )
    check(
        "workflow_bodies_distinct",
        len({tuple(item["instruction"] for item in skill["workflow"]) for skill in skills}) == 60
    )
    check(
        "input_keys_unique",
        all(
            len({item["key"] for item in skill["required_inputs"]}) == len(skill["required_inputs"]) for skill in skills
        )
    )
    check(
        "all_skills_have_concrete_output_checks",
        all(all(len(item["acceptance_criteria"]) >= 30 for item in skill["deliverables"]) for skill in skills)
    )
    check(
        "all_skills_have_boundaries_and_limits",
        all(len(skill["limitations"]) >= 2 and len(skill["permission_boundaries"]) >= 2 for skill in skills)
    )
    check(
        "builtin_access_free",
        all(skill["builtin"] and skill["price"]["amount"] == 0 for skill in skills)
        and catalog["cost_policy"]["skill_access_price"] == 0
    )
    check("no_additional_paid_api_dependency", catalog["cost_policy"]["additional_paid_api_dependency"] is False)
    check(
        "actual_api_billing_not_fixed_credits",
        catalog["cost_policy"]["execution_billing_basis"] == "actual_api_cost"
        and catalog["cost_policy"]["usage_display"] == "weekly_limit_percentage"
        and catalog["cost_policy"]["fixed_model_credit_cost"] is False
    )
    check(
        "auto_default_bounded",
        catalog["selection_defaults"]["mode"] == "auto"
        and catalog["selection_defaults"]["max_active_skills"] == 3
        and catalog["selection_defaults"]["load_full_catalog_into_model_context"] is False
    )
    keys = ("id", "category", "name", "summary", "triggers", "exclusions", "routing_tags")
    check(
        "index_exactly_matches_catalog_metadata",
        index["skills"] == [{field_name: skill[field_name] for field_name in keys} for skill in skills]
    )
    check("index_has_no_workflow_bodies", all("workflow" not in skill for skill in index["skills"]))
    check("index_version_matches", index["catalog_version"] == catalog["catalog_version"])
    cases = acceptance_fixtures["cases"]
    check("40_unique_acceptance_cases", len(cases) == 40 and len({entry["id"] for entry in cases}) == 40)
    for entry in cases:
        for field_name in ["expected_primary"]:
            if entry.get(field_name) is not None:
                check(entry["id"] + "_" + field_name + "_exists", entry[field_name] in known_skill_ids)
        for field_name in [
            "allowed_supporting",
            "must_not_select",
            "required_across_stages",
            "selected_ids",
            "excluded_ids",
        ]:
            if field_name in entry:
                check(
                    entry["id"] + "_" + field_name + "_exist",
                    all(item in known_skill_ids for item in entry[field_name])
                )
        if "manual_ids" in entry and entry["id"] != "unknown-id":
            check(entry["id"] + "_manual_ids_exist", all(item in known_skill_ids for item in entry["manual_ids"]))
        if entry["kind"] == "routing":
            check(
                entry["id"] + "_no_contradictory_expectation",
                entry["expected_primary"] not in entry["must_not_select"]
                and not (set(entry["allowed_supporting"]) & set(entry["must_not_select"]))
            )
    check(
        "fixtures_cover_required_concerns",
        {"routing", "staging", "state", "runtime", "ui", "billing", "permission", "privacy"}
        <= {entry["kind"] for entry in cases}
    )
    report = {
        "result": "pass",
        "schema_version": catalog["schema_version"],
        "skill_count": len(skills),
        "category_counts": expected_category_counts,
        "checks_passed": len(checks),
        "checks": checks,
        "acceptance_fixture_count": len(cases),
        "application_routing_tests_executed": False,
        "repository_code_changed": False,
        "scope": (
            "Catalog schema, content structure, uniqueness, billing invariants, index parity, and fixture "
            "references only. Application routing, UI, billing integration, and permissions must be tested "
            "in the target repository."
        ),
        "catalog_sha256": hashlib.sha256((bundle_path / "builtin-skills.catalog.json").read_bytes()).hexdigest(),
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="내장 스킬 카탈로그 검사")
    parser.add_argument("--output", type=Path, default=ROOT / "validation-report.json", help="검증 보고서 저장 경로")
    arguments = parser.parse_args()
    report = validate_catalog()
    arguments.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary_fields = (
        "result",
        "skill_count",
        "category_counts",
        "checks_passed",
        "acceptance_fixture_count",
        "application_routing_tests_executed",
        "catalog_sha256",
    )
    print(json.dumps({field_name: report[field_name] for field_name in summary_fields}, indent=2))


if __name__ == "__main__":
    main()
