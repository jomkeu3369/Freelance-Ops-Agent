# 로컬 Compose 및 Swagger 작업 인수인계

> 기준일: 2026-08-10  
> 기준 branch: `main`  
> 기준 commit: `d05376d` (`Spring Data JPA 전환`)

## 목적

다른 PC에서 PostgreSQL, Python Agent, Spring Boot를 한 번에 기동해 V2 연결 상태를 검증하고, 이후 Swagger를 추가하기 위한 인수인계 문서다.

## 다른 PC에서 시작하기

```powershell
git switch main
git pull origin main
git status
docker compose -f docker-compose-infra.yaml config --quiet
docker compose -f docker-compose.yaml config --quiet
```

`.env`와 API key는 Git으로 전달하지 않는다. 필요한 값은 각 PC의 로컬 `.env`에 직접 설정한다. Compose는 로컬 개발용 기본 DB password를 제공하지만 외부 공개 환경이나 운영 환경에서는 반드시 별도 secret을 사용한다.

다른 PC의 Codex에는 저장소를 연 뒤 다음과 같이 요청한다.

```text
AGENTS.md, README.md, docs/V2_SPECIFICATION.md, docs/STATUS.md,
docs/operations/local-compose-and-swagger-handoff.md를 순서대로 읽고
현재 main branch 상태를 확인하세요.
그다음 handoff 문서의 순서대로 Compose 전체 기동과 Testcontainers 검증부터 진행하세요.
기존 변경을 보존하고 검증 결과를 docs/STATUS.md에 기록하세요.
```

## Compose 범위

로컬 Compose는 두 파일로 분리한다.

- `docker-compose-infra.yaml`: PostgreSQL 17 + pgvector, 공유 network와 volume
- `docker-compose.yaml`: FastAPI + LangGraph Agent와 Spring Boot Backend

두 Compose project는 `freelance-ops-v2-internal` external network를 공유한다. infra를 먼저 기동해야 `postgres` hostname과 network가 준비된다. 현재 `frontend`는 Compose에 포함되지 않는다. Agent의 8000 포트는 Docker 내부 network에만 노출하고, 호스트에는 Spring Boot의 8080 포트만 공개한다.

## 실행과 확인

Docker Desktop을 먼저 실행한다.

```powershell
docker compose -f docker-compose-infra.yaml up -d --wait
docker compose -f docker-compose-infra.yaml ps
docker compose -f docker-compose.yaml up --build -d --wait
docker compose -f docker-compose.yaml ps
curl http://localhost:8080/actuator/health/readiness
docker compose -f docker-compose-infra.yaml logs postgres
docker compose -f docker-compose.yaml logs backend agent
```

정상 기준은 세 container가 실행 중이고 PostgreSQL과 Agent가 healthy이며, Spring readiness가 `UP`을 반환하는 것이다.

종료할 때는 다음 명령을 사용한다.

```powershell
docker compose -f docker-compose.yaml down
docker compose -f docker-compose-infra.yaml down
```

infra의 `down -v`는 로컬 PostgreSQL volume과 데이터를 삭제하므로 초기화가 명시적으로 필요한 경우에만 사용한다.

## 현재 검증 상태

- 기존 단일 `compose.v2.yaml`의 config 검증은 통과했으며, 현재는 infra와 application 파일로 분리됨
- JPA 전환 후 backend 단위 테스트 15건 통과
- 현재 PC에서 Docker Desktop이 중지되어 PostgreSQL Testcontainers 통합 테스트 4건은 skip
- V2 image build와 세 서비스의 전체 Compose 기동은 아직 검증하지 않음

따라서 다른 PC에서 가장 먼저 전체 Compose 기동과 Testcontainers 재검증을 수행한다.

## Swagger 현재 상태

Springdoc OpenAPI 3과 Swagger UI 구성이 추가됐다.

- 기본 profile에서는 OpenAPI 문서와 Swagger UI가 비활성화됨
- Compose는 기본적으로 `development` profile을 사용해 `/swagger-ui.html`과 `/v3/api-docs`를 활성화함
- Spring 공개 API인 `/api/**`만 문서화함
- 현재 문서화된 Spring endpoint는 `/api/v1/meta`임
- Swagger UI와 API 문서 경로는 인증 없이 열리지만 `/api/**` 실행은 HTTP Basic 인증이 필요함
- `contracts/openapi/agent-internal-api.yaml`과 `contracts/openapi/spring-tool-api.yaml`은 서비스 간 정적 계약이며 Swagger UI와 연결되지 않음
- OpenAPI metadata와 Basic security scheme 단위 테스트는 통과했지만 실제 Compose endpoint는 아직 검증하지 않음

## Swagger 구현 원칙

- 브라우저가 호출하는 Spring 공개 API만 기본 Swagger UI에 노출한다.
- Spring-Agent 내부 계약은 `contracts/openapi/`에서 별도로 versioning한다.
- 개발 환경에서는 Swagger UI와 API docs 경로를 허용한다.
- 운영 환경에서는 Swagger를 비활성화하거나 관리자 권한으로 제한한다.
- JPA entity를 API schema로 직접 노출하지 않고 request/response DTO를 사용한다.
- 인증, workspace 범위와 permission 요구사항을 endpoint 문서에 명시한다.

## 다음 작업 순서

1. Docker Desktop을 실행하고 `docker-compose-infra.yaml`의 PostgreSQL을 먼저 healthy 상태로 만든다.
2. `docker-compose.yaml`의 Agent와 Backend image를 build하고 health와 container log를 확인한다.
3. `backend`의 Testcontainers 테스트 4건을 Docker 환경에서 재실행한다.
4. `http://localhost:8080/swagger-ui.html`과 `/v3/api-docs` 응답을 확인한다.
5. Spring 시작 로그의 개발용 사용자 정보로 Swagger Authorize를 수행하고 `/api/v1/meta`를 호출한다.
6. 첫 Workspace API가 구현되면 Swagger 문서와 permission 요구사항을 추가한다.
7. Swagger/API docs 기동 검증 결과를 `docs/STATUS.md`에 기록한다.

## 완료 기준

- 전체 Compose 서비스가 healthy 상태다.
- Spring readiness endpoint가 `UP`이다.
- Backend 테스트가 skip 없이 통과한다.
- 개발 환경에서 Swagger UI가 열린다.
- 공개 API와 내부 Agent 계약의 문서 경계가 분리되어 있다.
