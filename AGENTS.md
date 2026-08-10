# Freelance Ops Agent 작업 지침

이 파일은 작업 환경이나 Codex 세션이 바뀌어도 동일한 기준으로 작업하기 위한 저장소 지침이다.

## 작업 시작 전 읽기 순서

1. `README.md`: V1의 배경과 현재 공개 설명
2. `docs/V2_SPECIFICATION.md`: V2 제품·기술 기준
3. `docs/STATUS.md`: 마지막 작업 상태와 다음 작업
4. `docs/adr/`: 이미 확정된 아키텍처 결정
5. 현재 branch의 `git status`와 최근 commit

문서가 충돌하면 최신 Accepted ADR, V2 명세, STATUS 순으로 판단하고 충돌을 사용자에게 알린다.

## V2 아키텍처 불변조건

- Spring Boot는 인증, workspace-scoped RBAC, CRM, 프로젝트, 견적, 감사 기록과 업무 트랜잭션을 소유한다.
- FastAPI + LangGraph 서비스는 prompt, Agent graph, ReAct loop, HITL checkpoint, OpenAI/Gemini 호출과 AI 평가를 소유한다.
- 브라우저는 Spring Boot 공개 API만 호출한다. Python Agent API는 Docker 내부 network에만 노출한다.
- Python Agent는 Spring이 소유한 business table을 직접 읽거나 변경하지 않는다.
- Agent Tool은 인증된 Spring internal REST API를 통해 실행한다. 핵심 흐름이 안정된 뒤 같은 계약을 MCP로 확장할 수 있다.
- PostgreSQL + pgvector가 유일한 운영 database다. `app`과 `agent_runtime` schema 및 DB credential을 분리한다.
- MongoDB, Kafka, 운영 FAISS를 다시 도입하지 않는다. 필요성이 benchmark와 ADR로 입증된 경우에만 재검토한다.
- FAISS는 오프라인 retrieval baseline에서만 사용할 수 있다.
- OpenAI/Gemini provider와 model은 Agent run마다 명시하고 기록한다. 초기에는 조용한 자동 fallback을 사용하지 않는다.
- 금액, 세금, 할인과 합계는 결정적인 Java Tool에서 계산한다. LLM이 계산 결과를 임의로 덮어쓰지 않는다.
- 모든 견적 항목에는 evidence 또는 명시된 assumption이 있어야 한다.
- 비공개 chain-of-thought를 저장하거나 노출하지 않는다. 사용자에게는 source, 계산식, assumption, Tool 실행 요약을 제공한다.

## 보안과 권한

- 모든 사용자 소유 데이터 query에 `workspace_id`를 적용한다.
- role 이름이 아니라 permission code를 검사하고 deny by default를 적용한다.
- 다른 workspace의 resource는 권한과 관계없이 접근할 수 없다.
- Agent와 Tool은 실행 사용자의 위임된 권한을 넘을 수 없다. write Tool은 실행 직전에 현재 권한을 재검증한다.
- Docker network는 인증 수단이 아니다. Spring과 Agent 사이는 짧은 수명의 audience-bound delegation token으로 인증한다.
- `.env`, API key, token, 실제 고객 데이터, 개인 정보와 운영 secret을 commit하지 않는다.
- 예시는 `.env.example`에 값 없이 기록한다.

## 변경 원칙

- V1 코드는 V2 migration 기준선으로 보존한다. 명시적인 migration 작업 전에는 무관한 V1 코드를 대규모 정리하지 않는다.
- 새 기능 전에 관련 domain rule, permission, API contract와 acceptance criterion을 먼저 확인한다.
- 서비스 간 schema는 versioned OpenAPI/Pydantic DTO로 관리하며 LangChain 내부 객체를 contract로 노출하지 않는다.
- 발행된 견적은 직접 수정하지 않고 새 revision을 만든다.
- 큰 기술 결정은 구현 전에 `docs/adr/`에 기록한다.
- 기존 사용자 변경을 보존하고 무관한 dirty worktree 파일을 수정하지 않는다.

## 작업 종료 절차

1. 변경 범위에 맞는 test와 정적 검사를 실행한다.
2. `git diff`와 `git status`로 예상하지 않은 변경을 확인한다.
3. `docs/STATUS.md`의 완료 항목, 다음 작업, 검증 결과와 blocker를 갱신한다.
4. 공개 저장소에 민감 정보가 포함되지 않았는지 확인한다.
5. 사용자가 요청한 경우에만 stage, commit, push한다.

## 계획된 검증 명령

V2 scaffold가 만들어진 뒤 다음 명령을 기준으로 한다. 실제 build 파일이 생기기 전에는 존재하지 않는 명령을 성공한 것처럼 보고하지 않는다.

```text
backend:  ./gradlew test
agent:    agent에서 uv run --locked pytest
frontend: npm run typecheck && npm test
e2e:      docker compose -f docker-compose-infra.yaml config && docker compose -f docker-compose.yaml config
```

V2 Python Agent의 dependency와 lock 기준은 `agent/pyproject.toml`과
`agent/uv.lock`이다. `legacy/v1`의 Poetry project는 V1·prototype
기준선이므로 명시적인 migration 전에는 V2 dependency를 추가하지 않는다.

Windows에서는 repository에 포함된 Gradle wrapper와 명시된 Python/Node runtime을 사용한다.
