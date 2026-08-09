# Freelance Ops Agent V2

프리랜서의 고객 요구사항을 구조화하고, 근거가 연결된 견적·거래 조건·리스크 검토를 지원하는 멀티테넌트 서비스입니다.

V2는 포트폴리오와 실제 운영을 모두 목표로 하며 다음 경계를 유지합니다.

- Spring Boot: 인증, workspace-scoped RBAC, CRM, 프로젝트, 견적과 감사 기록
- FastAPI + LangGraph: 제한형 Supervisor, Agent graph, HITL, OpenAI/Gemini 호출과 평가
- PostgreSQL + pgvector: 유일한 운영 데이터베이스
- React frontend: Spring 공개 API만 호출

## Repository structure

```text
backend/       Spring Boot 제품 backend와 Java 자동 테스트
agent/         FastAPI/LangGraph runtime과 Python 자동 테스트
frontend/      React frontend
contracts/     서비스 간 versioned OpenAPI 계약
infra/         PostgreSQL 초기화 등 운영 infrastructure
experiments/   ReAct·Supervisor·retrieval 비교 실험
legacy/v1/     마이그레이션 기준선으로 보존한 V1 코드
docs/          V2 명세, ADR, 작업 상태와 검증 문서
```

자동 회귀 테스트와 notebook·일회성 실험을 혼합하지 않습니다. 서비스 테스트는 각 서비스 내부에 두고, 실험 자료만 `experiments/`에서 관리합니다.

## Local verification

```text
backend:   cd backend && ./gradlew test
agent:     cd agent && uv sync --locked && uv run --locked pytest
frontend:  cd frontend && npm run typecheck && npm test
compose:   docker compose -f compose.v2.yaml config
```

Windows에서는 `backend/gradlew.bat`을 사용합니다.

## Documentation

- [V2 제품·기술 명세](docs/V2_SPECIFICATION.md)
- [현재 작업 상태](docs/STATUS.md)
- [Architecture Decision Records](docs/adr/README.md)
- [Agent Tool catalog](docs/agent-tools/TOOL_CATALOG.md)

V1의 설명과 실행 자료는 [legacy/v1/README.md](legacy/v1/README.md)에 보존합니다.
