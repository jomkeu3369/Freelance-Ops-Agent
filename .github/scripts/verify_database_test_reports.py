#!/usr/bin/env python3
"""Fail CI when database/native-attachment suites were not actually executed.

Reads only generated JUnit reports and committed test source paths. No database,
provider, or production credentials are used by this report check.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


def expected_suites(root: Path, component: str) -> set[str]:
    if component == "backend":
        expected = set()
        for path in (root / "backend/src/test/java").rglob("*Test.java"):
            source = path.read_text(encoding="utf-8")
            if "@Testcontainers" not in source:
                continue
            package = re.search(r"^package\s+([\w.]+);", source, re.MULTILINE)
            if package is None:
                raise ValueError(f"Missing Java test package: {path}")
            expected.add(f"{package[1]}.{path.stem}")
        return expected
    test_root = root / "agent"
    paths = set((test_root / "tests/integration").glob("test_*.py"))
    # Native attachment/OCR tests must also run, rather than skip absent tools.
    paths.update((test_root / "tests").glob("test_attachment*.py"))
    return {".".join(path.relative_to(test_root).with_suffix("").parts) for path in paths}


def validate(expected: set[str], reports: list[Path]) -> list[str]:
    errors = []
    if not expected:
        errors.append("No required database test sources were found")
    if not reports:
        errors.append("No JUnit XML reports were found")
    counts = {name: {"tests": 0, "skipped": 0, "failed": 0} for name in expected}
    for report in reports:
        for case in ET.parse(report).getroot().iter("testcase"):
            classname = case.get("classname", "")
            for name, summary in counts.items():
                if classname == name or classname.startswith(name + ".") or classname.startswith(name + "$"):
                    summary["tests"] += 1
                    summary["skipped"] += case.find("skipped") is not None
                    summary["failed"] += case.find("failure") is not None or case.find("error") is not None
                    break
    for name, summary in sorted(counts.items()):
        print(f"{name}: tests={summary['tests']}, skipped={summary['skipped']}, failed={summary['failed']}")
        if not summary["tests"]:
            errors.append(f"Required suite is missing or collected no tests: {name}")
        if summary["skipped"]:
            errors.append(f"Required suite skipped {summary['skipped']} test(s): {name}")
        if summary["failed"]:
            errors.append(f"Required suite failed {summary['failed']} test(s): {name}")
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
        errors = [f"Cannot validate test evidence: {error}"]
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
