"""모델에 전달하는 JSON Schema 정규화."""

from __future__ import annotations

import json
from contextlib import suppress
from typing import Any


def strict_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """모든 속성을 필수로 선언하고 추가 속성을 금지하도록 Pydantic 스키마를 정규화한다."""

    def normalize(value: object) -> None:
        if isinstance(value, dict):
            value.pop("default", None)
            properties = value.get("properties")
            if value.get("type") == "object" and isinstance(properties, dict):
                value["additionalProperties"] = False
                value["required"] = list(properties)
            for nested in value.values():
                normalize(nested)
        elif isinstance(value, list):
            for nested in value:
                normalize(nested)

    normalized = schema.copy()
    normalize(normalized)
    return normalized


def compact_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """스키마 설명 항목만 제거한다. 검증 조건과 사용자 속성 이름은 보존한다."""
    annotation_keywords = {"title", "description", "default", "examples", "$comment"}
    schema_map_keywords = {"properties", "patternProperties", "$defs", "definitions", "dependentSchemas"}
    schema_keywords = {
        "items",
        "contains",
        "additionalProperties",
        "propertyNames",
        "not",
        "if",
        "then",
        "else",
        "unevaluatedItems",
        "unevaluatedProperties",
    }
    schema_list_keywords = {"allOf", "anyOf", "oneOf", "prefixItems"}

    def compact(node: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in node.items():
            if key in annotation_keywords:
                continue
            if key in schema_map_keywords and isinstance(value, dict):
                result[key] = {
                    name: compact(child) if isinstance(child, dict) else child for name, child in value.items()
                }
            elif key in schema_keywords and isinstance(value, dict):
                result[key] = compact(value)
            elif key in schema_list_keywords and isinstance(value, list):
                result[key] = [compact(child) if isinstance(child, dict) else child for child in value]
            else:
                # const와 enum 내부 객체는 설명 키와 같은 이름의 실제 데이터를 포함할 수 있다.
                result[key] = value
        return result

    return compact(schema)


def compact_prompt_and_schema(prompt: str, schema: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    # 같은 데이터를 압축하되 업무·안전 지시와 사용자 선호, 근거 자료를 보존한다.
    # 필수 필드와 검증 조건도 그대로 유지한다.
    with suppress(TypeError, ValueError):
        prompt = json.dumps(json.loads(prompt), ensure_ascii=False, separators=(",", ":"))
    return prompt, compact_json_schema(schema)
