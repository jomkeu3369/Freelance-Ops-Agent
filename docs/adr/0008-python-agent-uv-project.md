# ADR-0008: Python Agent의 uv 프로젝트 관리

- 상태: Accepted
- 결정일: 2026-07-29

## Context

V2는 Spring Boot 제품 backend와 Python Agent runtime을 분리하며 Python
서비스는 `src/agent`에 위치한다. 저장소 루트에는 V1과 기존 prototype
평가에 사용한 Poetry 기반 `pyproject.toml`과 lock file이 존재한다.

V2 Agent는 Docker, CI와 여러 개발 PC에서 같은 Python dependency graph를
재현해야 한다. 동시에 V1 기준선을 보존하면서 새 Agent의 dependency와
virtual environment 경계를 명확히 분리해야 한다.

## Decision

- V2 Python Agent는 `src/agent`를 root로 하는 독립적인 uv 프로젝트로 관리한다.
- V2 Agent의 직접 dependency와 project metadata는
  `src/agent/pyproject.toml`에 기록한다.
- 재현 가능한 dependency resolution은 `src/agent/uv.lock`에 기록하고
  repository에 함께 commit한다.
- 개발, test, CI와 Docker 명령은 `src/agent`에서 `uv run`과 검증된 lock
  file을 기준으로 실행한다.
- CI와 image build는 lock file과 metadata가 불일치하면 dependency를
  묵시적으로 다시 해석하지 않고 실패해야 한다.
- Python runtime의 정확한 버전은 Agent scaffold와 Docker image에서
  명시적으로 고정한다. V2 명세의 Python 3.12+ 기준을 벗어나는 변경은
  호환성 검증 후 별도 기록한다.
- V2 Agent dependency를 저장소 루트 Poetry project에 추가하지 않는다.
- 저장소 루트의 Poetry 파일은 V1·prototype 기준선으로 취급한다. 명시적인
  migration 작업 전에는 삭제하거나 uv lock과 혼합하지 않는다.
- 개발자는 global Python 환경에 직접 package를 설치하지 않고 uv가 관리하는
  project environment를 사용한다.

기본 검증 위치와 명령은 다음과 같다.

```text
working directory: src/agent
dependency sync:   uv sync --locked
test:              uv run --locked pytest
```

실제 `pyproject.toml`과 `uv.lock`이 생성되기 전에는 위 명령을 성공한
검증으로 보고하지 않는다.

## Consequences

장점:

- V2 Agent dependency가 V1 Poetry 환경과 분리된다.
- 로컬, CI와 Docker가 같은 lock file을 사용해 재현성이 높아진다.
- Python 명령 진입점을 `uv run`으로 통일할 수 있다.
- dependency 설치와 environment 준비 시간을 줄일 수 있다.

비용:

- 저장소에 Poetry와 uv 기반 project가 migration 기간 동안 함께 존재한다.
- 개발자는 명령을 실행할 Python project root를 구분해야 한다.
- CI, Dockerfile과 IDE 설정을 `src/agent`의 uv project에 맞춰야 한다.
- root prototype을 V2 Agent로 옮길 때 dependency와 test 경계를 명시적으로
  재정리해야 한다.

## Rejected alternatives

- V2 Agent도 루트 Poetry project에 포함: V1과 V2 dependency 경계가 섞이고
  독립적인 Agent image와 CI 재현성이 낮아지므로 거부한다.
- `requirements.txt`만 사용: project metadata와 lock resolution 기준이
  분산되므로 거부한다.
- global Python environment 사용: 개발 PC와 CI 사이 재현성을 보장할 수
  없으므로 거부한다.
