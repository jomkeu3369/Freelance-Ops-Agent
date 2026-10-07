# Agent

FastAPI + LangGraph 서비스가 prompt, Supervisor graph, ReAct loop, HITL checkpoint, OpenAI/Gemini 호출과 AI 평가를 소유한다.

## Local verification

```powershell
uv sync --locked
uv run --locked pytest
uv run --locked ruff check .
uv run --locked mypy
```

Agent는 Spring Boot가 소유한 업무 table을 직접 읽거나 수정하지 않는다. 모든 업무 Tool은 audience-bound delegation token을 사용해 Spring internal REST API를 호출한다.

## Internal API

- `GET /health`: 프로세스 liveness
- `GET /health/readiness`: startup·checkpoint open·DB query 점검, 준비되지 않으면 `503 DOWN`
- `POST /internal/v1/agent-runs`: 인증된 run 시작
- `GET /internal/v1/agent-runs/{runId}`: run 상태·HITL interruption·결과 조회
- `GET /internal/v1/agent-runs/{runId}/events`: 재연결 cursor를 지원하는 SSE run event 조회
- `POST /internal/v1/agent-runs/{runId}/resume`: idempotent HITL 응답
- `POST /internal/v1/agent-runs/{runId}/cancel`: 실행 대기·진행·HITL 대기 run 취소
- `POST /internal/v1/raptor/build`: Spring 소유 원문 chunk로 storage-neutral RAPTOR node 생성

readiness의 DB 대기는 1초이며 프로세스당 진행 중인 점검 하나를 공유한다. DB 장애 중 driver 취소가 지연돼도 HTTP 응답과 후속 probe가 쌓이지 않는다. `/health`는 DB 장애에도 UP을 유지한다. 이 경로들은 Docker 내부에서만 사용하며 모델 provider의 실제 응답 품질은 별도로 검수한다.

로컬 실행은 memory run store를 사용한다. Compose와 production은
`AGENT_RUN_STORE_BACKEND=postgres`를 사용하며 production에서 memory 설정은 거부된다.
PostgreSQL 연결과 run/event CRUD는 SQLAlchemy 2 비동기 ORM만 사용하며 직접 SQL 문자열을
작성하지 않는다. ORM entity는 Agent 소유 `agent_runtime` schema에만 존재한다.
운영 schema 변경은 `migrations/`의 Alembic revision으로 관리한다. PostgreSQL runtime을 직접
실행할 때는 서버 시작 전에 다음 migration을 적용한다.

```powershell
$env:AGENT_DATABASE_URL='postgresql://agent_user:password@localhost:5432/freelance_ops'
uv run --locked alembic upgrade head
```

Docker image는 같은 migration을 적용한 뒤 API process를 시작하며, migration이 누락된 경우
Agent는 필요한 runtime table을 임의 생성하지 않고 startup을 실패시킨다.
상세 lifecycle snapshot은 공식 `AsyncPostgresSaver`가 같은 schema에 기록하며 production에서는
run store와 checkpointer를 모두 PostgreSQL로 강제한다. checkpoint에는 delegation token이나
비공개 chain-of-thought를 저장하지 않는다.
내부 API는 `AGENT_DELEGATION_TOKEN_PUBLIC_KEY`와 issuer/audience가 일치하는 짧은 수명의
RSA 서명 JWT만 허용한다. 운영 routing prompt 원문은 저장소가 아니라 secret manager에서
`AGENT_ROUTE_EVALUATOR_SYSTEM_PROMPT`로 주입하고 version과 승인 SHA-256을 함께 설정한다.

`src/departments/research_deep_agent.py`는 ADR-0013 검증용 spike다. StateBackend와
run-scoped 파일 권한을 사용하고 general-purpose subagent·host shell을 비활성화한다.
동일 frozen dataset의 단일 ReAct baseline보다 품질·비용·latency가 개선되기 전에는
운영 run executor에 연결하지 않는다.

부서 structured generation과 RAPTOR build는 요청에 기록된 `OPENAI` 또는 `GEMINI` provider를
명시적으로 사용한다. provider 간 조용한 fallback은 없으며 일시적인 timeout·429·5xx만 제한적으로
재시도한다. Spring Tool client는 versioned OpenAPI의 project context, domain pack,
requirements validation과 deterministic quote calculation을 지원한다.


## Bounded personal-key execution

New personal-key runs require `byokBudget`, issued and persisted by Spring for the exact
run, workspace, project, initiating user, credential, OpenAI model, reasoning effort and
full run budget. `platformBudget` cannot be combined with it, and merely supplying a
credential ID never bypasses admission. Gemini and retired models remain unavailable.
Existing personal-key runs without this scope cannot be silently upgraded on resume.

Each generation attempt (including explicit transport and invalid-JSON retries) first
atomically consumes a backend call and conservative input/output reservation, then
persists an Agent attempt record, then re-resolves the selected credential. Reservations
are never refunded, even for cancellation, failed credential resolution, lost responses
or process death. BYOK reports zero platform cost, not an estimate of the user's provider
bill. Actual usage does not replenish the reserved token allowance. Every attempt's
output ceiling divides the run allowance across the planned departments and retries
(one AD_HOC department or four project departments, capped by maxModelCalls), so
earlier work cannot reserve the whole output allowance. For example, 48000 tokens
and one retry per department permit 6000 tokens per project attempt. Runs can stop early when conservative limits bind.

Provider I/O uses one explicit HTTPS Responses request with the selected bearer key,
no SDK/environment key or billing-header inheritance, no redirects/proxy environment,
no SDK retries, default service tier, text-only input, no built-in tools and `store=false`.
Scope validity is rechecked after admission, persistence and credential I/O and just
before the provider request. A fixed initial wall-clock expiry bounds the whole run,
including HITL waiting; resume never creates a new deadline or resets counters. Worker
scope closure blocks detached late calls. Durable PostgreSQL run storage is required.

BYOK AD_HOC routing is deterministic and local; safety/direct-tool/project-analysis
policy gates remain in place. Project knowledge uses read-only keyword retrieval and
never invokes query embeddings. Paid web research, RAPTOR, pets, assumptions, detached
A2A and experimental Deep Agent paths remain fail-closed. Internal project departments
can still generate through the same selected-key, durably admitted path.

Offline regressions are in `tests/test_byok_budget.py`; they intercept every backend and
provider HTTP request and exercise production guards without actual keys/provider I/O.

### Approved personal-key limits

The approved BYOK input ceiling is **150000 tokens in aggregate per run**, including
all departments, retries and resumed execution. Platform-funded input remains 50000.
All other ceilings are unchanged: 48000 aggregate output tokens, 50 model calls,
180 seconds, 12 tool calls, 4 departments, hierarchy depth 2, 2 search credits,
2 retries and 3 handoffs. This does not enable paid search or detached task execution.
The backend issues the exact scope; the Agent never increases or replenishes it.

The full four-department PROJECT_ANALYSIS path performs a minimum-plan preflight
before its first attempt. A realistic Korean request with three selected skills and
modest confirmed project context fits within 150000 under mocked transport tests,
including three distinct quotation scenarios. This is an orchestration/guard test,
not live provider-quality or price verification. The unchanged 8192-per-attempt
protocol allowance and exact UTF-8 request bytes remain conservatively reserved.
An oversized plan returns `BYOK_PLAN_INPUT_BUDGET_EXCEEDED` before any provider call.

150000 is not a promise that every tool/retry plan finishes: further observations
and retries also consume the aggregate cap. If a later model/token cap is exhausted,
completed departments are preserved as a partial result and all attempts remain
accounted for; the scope closes without replenishment. Security/expiry failures stay
fatal. Existing 50000-token scopes keep their original bound on resume, and legacy
records without a scope cannot be upgraded into the new path.
