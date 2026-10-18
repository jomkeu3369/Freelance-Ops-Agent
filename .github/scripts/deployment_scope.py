"""변경 경로를 서비스·계약 검증과 배포 범위로 분류한다."""

from __future__ import annotations

import argparse
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DeploymentScope:
    agent: bool = False
    backend: bool = False
    contracts: bool = False


def classify_paths(paths: list[str]) -> DeploymentScope:
    components: set[str] = set()
    for path in paths:
        if path.startswith("agent/") or path in {
            ".github/workflows/agent-ci.yml",
            ".github/workflows/agent-cd.yml",
        }:
            components.add("agent")
        elif path.startswith("backend/") or path in {
            ".github/workflows/backend-ci.yml",
            ".github/workflows/backend-cd.yml",
        }:
            components.add("backend")
        elif path.startswith(
            ("contracts/", "infra/scripts/", ".github/actions/deploy-service/")
        ) or path in {
            "docker-compose.yaml",
            "docker-compose.production.yaml",
            ".github/workflows/production-auto-cd.yml",
            ".github/scripts/deployment_scope.py",
        }:
            components.update(("agent", "backend", "contracts"))
        elif path == ".github/scripts/verify_database_test_reports.py":
            components.update(("agent", "backend"))
        elif path.startswith("infra/caddy/"):
            components.update(("backend", "contracts"))
        elif path.startswith("infra/postgres/") or path in {
            "docker-compose-infra.yaml",
            ".github/workflows/contracts-compose-ci.yml",
        }:
            components.add("contracts")
    return DeploymentScope(
        **{name: name in components for name in ("agent", "backend", "contracts")}
    )


def changed_paths(base: str, head: str, *, repository: Path | None = None) -> list[str]:
    if base and set(base) == {"0"}:
        output = subprocess.check_output(
            ["git", "ls-tree", "-r", "--name-only", "-z", head], cwd=repository
        )
        return [path for path in output.decode("utf-8").split("\0") if path]
    # 삭제와 폴더 간 이동도 양쪽 서비스의 변경으로 취급한다.
    output = subprocess.check_output(
        [
            "git",
            "diff",
            "--no-ext-diff",
            "--no-renames",
            "--name-only",
            "-z",
            "--diff-filter=ACDMRT",
            base,
            head,
        ],
        cwd=repository
    )
    return [path for path in output.decode("utf-8").split("\0") if path]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    scope = classify_paths(changed_paths(args.base, args.head))
    for name in ("agent", "backend", "contracts"):
        print(f"{name}={str(getattr(scope, name)).lower()}")


if __name__ == "__main__":
    main()
