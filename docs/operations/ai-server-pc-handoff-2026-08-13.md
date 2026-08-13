# AI 서버 PC 이전 인수인계

> 기준일: 2026-08-13  
> 기준 branch: `main`  
> 상태: 작업 중단 시점의 dirty worktree, 아직 commit·push하지 않음

## 가장 중요한 전달 사항

현재 변경은 `main` working tree에만 있으며 commit되지 않았다. 다른 PC에서 `git pull`만
하면 이 변경을 받을 수 없다. 다음 중 하나가 먼저 필요하다.

1. 현재 PC에서 사용자 승인 후 변경을 검토해 commit·push한다.
2. `.git`, `.env`, virtual environment와 build cache를 제외한 working tree를 안전하게 옮긴다.

API key, delegation private key, `.env`, 실제 고객 데이터는 Git이나 일반 압축 파일에
포함하지 않는다.

## 새 PC에서 먼저 읽을 문서

1. `AGENTS.md`
2. `README.md`
3. `docs/V2_SPECIFICATION.md`
4. `docs/STATUS.md`
5. `docs/adr/0011-spring-data-jpa-persistence.md`
6. `docs/adr/0013-deep-agents-department-runtime.md`
7. `docs/adr/0014-raptor-single-rag.md`
8. `docs/adr/0015-llm-first-operational-routing.md`
9. 이 문서

## 구현 완료 또는 로컬 검증된 범위

| 영역 | 현재 상태 | 근거 |
|---|---|---|
| Agent API | run 생성·조회·SSE·취소·HITL resume | Agent 전체 pytest 통과 |
| Agent DB | SQLAlchemy 2 async ORM 기반 run/event store | 직접 작성 SQL 금지 architecture test |
| Checkpoint | `AsyncPostgresSaver` adapter와 실행 graph | checkpoint 단위·resume 테스트 |
| Provider | OpenAI·Gemini run별 선택, timeout·제한 retry, 자동 fallback 없음 | provider 단위 테스트 |
| Routing | Safety Gate와 private prompt LLM evaluator, fail-closed | routing 회귀 테스트 |
| RAPTOR | provider-neutral leaf/summary tree build | OpenAI/Gemini adapter 테스트 |
| Spring Tool client | project context, domain pack, requirement validation, quote calculation | HTTP 오류·retry·DTO 테스트 |
| Spring Tool server | 위 4개 endpoint의 Controller·Service 구현 | backend 전체 테스트 통과 |
| Project 조회 | `findByIdAndWorkspaceId` Spring Data JPA ORM query | service 단위 테스트 |
| Tool 인증 | RS256, issuer, audience, expiry, subject, run binding, token scope 검사 | verifier/filter 테스트 |
| 권한 회수 | Tool 실행 직전 현재 Spring RBAC 재검사 | revoked permission 테스트 |
| 견적 계산 | `BigDecimal` 기반 결정적 할인·세금·합계 | 반올림 단위 테스트 |
| Trace | Agent 요청의 W3C `traceparent`를 Spring Tool HTTP 요청에 전달 | 코드 연결 및 Agent 회귀 테스트 |

최종 검증 결과는 다음과 같다.

- Backend Gradle test: 30건, 실패 0, 오류 0, skip 0
- Agent Ruff: 통과
- Agent strict mypy: 40개 source module 통과
- Agent pytest: 117건 통과
- OpenAPI 공식 validator: 마지막 Spring 응답 코드 변경까지 반영해 Agent/Spring 계약 모두 통과
- `git diff --check`: 통과

## 이번 중단 직전에 추가된 Spring 구현

- `backend/src/main/resources/db/migration/V3__project_context.sql`
- `backend/src/main/java/com/freelanceops/backend/project/**`
- `backend/src/main/java/com/freelanceops/backend/internaltool/**`
- `backend/src/test/java/com/freelanceops/backend/internaltool/**`
- `spring-boot-starter-oauth2-resource-server` dependency
- Spring internal Tool JWT filter와 현재 RBAC 재검증
- Backend Compose의 delegation 공개키·issuer·audience 설정 전달

Flyway migration은 schema 변경만 소유한다. 런타임 업무 조회는 직접 SQL을 사용하지 않고
Spring Data JPA Repository를 사용한다. Python Agent의 런타임 DB 접근도 SQLAlchemy ORM만
사용한다.

## 아직 완료되지 않은 범위

| 우선순위 | 미완료 항목 | 다음 검증 |
|---|---|---|
| P0 | Spring의 공개 Agent gateway와 delegation token 발급 | Spring→Agent 실제 HTTP contract test |
| P0 | 동일 RSA key pair를 사용한 Spring→Agent→Spring 왕복 | Testcontainers 또는 Compose E2E |
| P0 | internal Tool Controller의 실제 JWT HTTP 통합 테스트 | MockMvc + 실제 서명 token 또는 Compose |
| P0 | PostgreSQL checkpoint를 사용한 process restart 후 HITL resume | Agent 재시작 통합 테스트 |
| P1 | 운영 executor의 진짜 bounded ReAct Tool loop | fake model로 Tool 순서·반복·budget 테스트 |
| P1 | 최소 5개 구조화 Tool 충족 | `get_rate_card` 또는 `validate_quote` 계약 추가 |
| P1 | 견적 항목별 evidence 또는 assumption 강제 | 결과 schema와 verifier 강화 |
| P1 | RAPTOR node의 pgvector publish·retrieval | workspace/snapshot 격리 통합 테스트 |
| P1 | OpenAI·Gemini 실제 호출 smoke test | 로컬 secret 사용, 비용·model 기록 확인 |
| P2 | Research Deep Agent 승격 여부 | 단일 ReAct frozen benchmark와 비교 |

현재 Research Deep Agent는 보안 spike일 뿐 운영 executor에 연결되지 않았다. 로컬 router도
평가 결과에 따라 운영 결정을 내리지 않는 shadow/diagnostic 용도다.

## 새 PC 권장 실행 순서

### 1. 상태 확인

```powershell
git status --short
git branch --show-current
git log -5 --oneline
```

working tree가 전달되지 않았다면 이 문서 상단의 commit·push 또는 안전한 파일 이전이 먼저다.

### 2. Agent 환경

```powershell
cd agent
uv sync --locked
uv run --locked ruff check src tests
uv run --locked mypy --strict src
uv run --locked pytest -q -p no:cacheprovider --basetemp=.tmp-pytest-handoff
```

Windows 사용자 임시 폴더 ACL 문제를 피하려고 `--basetemp`를 저장소 내부로 지정한다. 테스트
후 해당 임시 폴더만 삭제한다.

### 3. Backend 환경

Java 21의 실제 설치 경로를 사용한다.

```powershell
$env:JAVA_HOME='C:\Program Files\Java\jdk-21.0.10'
cd backend
.\gradlew.bat test
```

Gradle cache 경로 권한 문제가 있으면 저장소 밖의 사용자 전용 cache 경로로
`GRADLE_USER_HOME`을 지정한다. cache를 Git에 추가하지 않는다.

### 4. OpenAPI 계약

```powershell
uvx --from openapi-spec-validator openapi-spec-validator `
  contracts/openapi/agent-internal-api.yaml `
  contracts/openapi/spring-tool-api.yaml
```

### 5. Compose

Docker Desktop을 시작한 뒤 기존 runbook을 따른다.

```powershell
docker compose -f docker-compose-infra.yaml config --quiet
docker compose -f docker-compose.yaml config --quiet
docker compose -f docker-compose-infra.yaml up -d --wait
docker compose -f docker-compose.yaml up --build -d --wait
```

운영형 Agent 시작에는 PostgreSQL store/checkpoint, delegation 공개키, OpenAI/Gemini key,
private routing prompt 원문·version·승인 SHA-256이 필요하다. secret은 `.env.example`에 값을
넣지 않고 새 PC의 로컬 `.env` 또는 secret manager에만 둔다.

## 다음 Codex 작업 요청문

```text
AGENTS.md, README.md, docs/V2_SPECIFICATION.md, docs/STATUS.md,
docs/operations/ai-server-pc-handoff-2026-08-13.md를 순서대로 읽으세요.
현재 branch와 dirty worktree를 먼저 확인하고 기존 변경을 보존하세요.
AI 서버 Phase 4 완료 조건을 좁히지 말고, P0부터 진행하세요.
Spring 업무 조회는 Spring Data JPA ORM, Python DB 접근은 SQLAlchemy ORM만 사용하세요.
먼저 Spring delegation token 발급과 Spring→Agent→Spring 실제 HTTP 통합 테스트를 완성하고,
그다음 PostgreSQL checkpoint 재시작 HITL resume를 검증하세요.
완료할 때 backend/agent/OpenAPI 검증 결과와 blocker를 docs/STATUS.md에 기록하세요.
```

## 주의할 점

- 브라우저는 Python Agent에 직접 접근하지 않는다.
- Python Agent는 Spring의 `app` business table을 읽지 않는다.
- Docker network 자체를 인증으로 간주하지 않는다.
- Tool 실행은 token permission과 현재 DB permission을 모두 검사한다.
- write Tool은 실행 직전에 권한을 재검증하며 자동 retry하지 않는다.
- private prompt, token, API key와 chain-of-thought를 저장하거나 출력하지 않는다.
- 현재 working tree에는 여러 날의 변경이 함께 있으므로 무관한 파일을 reset하거나 삭제하지 않는다.
