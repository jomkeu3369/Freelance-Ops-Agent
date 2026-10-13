#!/usr/bin/env python3
"""Require genuine, non-skipped executions of the connected workflow browser suites."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def validate(report: Path, required: dict[str, int | list[str]]) -> list[str]:
    cases = list(ET.parse(report).getroot().iter("testcase"))
    errors: list[str] = []
    for suite, expected in sorted(required.items()):
        minimum = expected if isinstance(expected, int) else len(expected)
        matching = [case for case in cases if case.get("classname", "").replace("\\", "/") == suite
            or ("/" not in suite and case.get("classname", "").replace("\\", "/").rsplit("/", 1)[-1] == suite)]
        skipped = sum(case.find("skipped") is not None for case in matching)
        failed = sum(case.find("failure") is not None or case.find("error") is not None for case in matching)
        print(f"{suite}: tests={len(matching)}, minimum={minimum}, skipped={skipped}, failed={failed}")
        if len(matching) < minimum:
            errors.append(f"Required browser suite is missing executions: {suite} ({len(matching)}/{minimum})")
        if isinstance(expected, list):
            recorded = {case.get("name", "") for case in matching}
            for name in expected:
                if name not in recorded:
                    errors.append(f"Required browser case did not execute: {suite}: {name}")
        if skipped:
            errors.append(f"Required browser suite skipped {skipped} test(s): {suite}")
        if failed:
            errors.append(f"Required browser suite failed {failed} test(s): {suite}")
    if not required:
        errors.append("No required browser suites were specified")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--require-suite", action="append", default=[], metavar="SUITE=MINIMUM")
    parser.add_argument("--contract", type=Path, help="JSON mapping exact suite filenames to required test titles")
    args = parser.parse_args()
    try:
        required = {}
        if args.contract:
            required = json.loads(args.contract.read_text())
            if not isinstance(required, dict) or any(not isinstance(suite, str) or not suite or
                not isinstance(names, list) or not names or len(names) != len(set(names)) or
                any(not isinstance(name, str) or not name.strip() for name in names)
                for suite, names in required.items()):
                raise ValueError("Invalid mandatory browser case contract")
        for value in args.require_suite:
            suite, minimum = value.rsplit("=", 1)
            if not suite or int(minimum) < 1 or suite in required:
                raise ValueError(f"Invalid or duplicate required suite: {value}")
            required[suite] = int(minimum)
        errors = validate(args.report, required)
    except (OSError, ValueError, ET.ParseError) as error:
        errors = [f"Cannot verify browser evidence: {error}"]
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
