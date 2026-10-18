#!/usr/bin/env python3
"""JUnit 보고서로 필수 DB·첨부파일 검사의 실행·실패·생략 여부를 확인한다.

검사 소스와 생성된 XML만 읽으며 DB나 외부 제공사에 접속하지 않는다.
"""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def expected_suites(root: Path, component: str) -> set[str]:
    if component == "backend":
        expected = set()
        for path in (root / "backend/src/test/java").rglob("*Test.java"):
            source = path.read_text(encoding="utf-8")
            if "@Testcontainers" not in source:
                continue
            package = re.search(r"^package\s+([\w.]+);", source, re.MULTILINE)
            if package is None:
                raise ValueError(f"Java 검사 패키지가 없습니다: {path}")
            expected.add(f"{package[1]}.{path.stem}")
        return expected
    if component != "agent":
        raise ValueError(f"지원하지 않는 검사 대상입니다: {component}")
    test_root = root / "agent"
    paths = set((test_root / "tests/integration").glob("test_*.py"))
    # 도구가 없다는 이유로 첨부파일·OCR 필수 검사가 생략되는 것도 차단한다.
    paths.update((test_root / "tests").glob("test_attachment*.py"))
    return {".".join(path.relative_to(test_root).with_suffix("").parts) for path in paths}


def validate(expected: set[str], reports: list[Path]) -> list[str]:
    errors = []
    if not expected:
        errors.append("필수 검사 소스를 찾지 못했습니다.")
    if not reports:
        errors.append("JUnit XML 보고서를 찾지 못했습니다.")
    counts = {name: {"tests": 0, "skipped": 0, "failed": 0} for name in expected}
    for report in reports:
        for case in ET.parse(report).getroot().iter("testcase"):
            classname = case.get("classname", "")
            for name, summary in counts.items():
                if (
                    classname == name
                    or classname.startswith(name + ".")
                    or classname.startswith(name + "$")
                ):
                    summary["tests"] += 1
                    summary["skipped"] += case.find("skipped") is not None
                    summary["failed"] += (
                        case.find("failure") is not None or case.find("error") is not None
                    )
                    break
    for name, summary in sorted(counts.items()):
        print(
            f"{name}: tests={summary['tests']}, skipped={summary['skipped']}, failed={summary['failed']}"
        )
        if not summary["tests"]:
            errors.append(f"필수 검사 묶음이 없거나 수집된 검사가 없습니다: {name}")
        if summary["skipped"]:
            errors.append(f"필수 검사 {summary['skipped']}개가 생략됐습니다: {name}")
        if summary["failed"]:
            errors.append(f"필수 검사 {summary['failed']}개가 실패했습니다: {name}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=("backend", "agent"))
    parser.add_argument("--repository-root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    root = args.repository_root.resolve()
    if args.component == "backend":
        reports = sorted((root / "backend/build/test-results/test").glob("TEST-*.xml"))
    else:
        reports = sorted((root / "agent/test-results").glob("*.xml"))
    try:
        errors = validate(expected_suites(root, args.component), reports)
    except (OSError, ValueError, ET.ParseError) as error:
        errors = [f"검사 근거를 확인할 수 없습니다: {error}"]
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
