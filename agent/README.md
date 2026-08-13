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

- `POST /internal/v1/agent-runs`: 인증된 run 시작
- `GET /internal/v1/agent-runs/{runId}`: run 상태·HITL interruption·결과 조회
- `GET /internal/v1/agent-runs/{runId}/events`: 재연결 cursor를 지원하는 SSE run event 조회
- `POST /internal/v1/agent-runs/{runId}/resume`: idempotent HITL 응답
- `POST /internal/v1/agent-runs/{runId}/cancel`: 실행 대기·진행·HITL 대기 run 취소
- `POST /internal/v1/raptor/build`: Spring 소유 원문 chunk로 storage-neutral RAPTOR node 생성

로컬 실행은 memory run store를 사용한다. Compose와 production은
`AGENT_RUN_STORE_BACKEND=postgres`를 사용하며 production에서 memory 설정은 거부된다.
PostgreSQL 연결과 run/event CRUD는 SQLAlchemy 2 비동기 ORM만 사용하며 직접 SQL 문자열을
작성하지 않는다. ORM entity는 Agent 소유 `agent_runtime` schema에만 존재한다.
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

