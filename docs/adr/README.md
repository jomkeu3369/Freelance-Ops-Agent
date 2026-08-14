# Architecture Decision Records

V2의 중요한 기술 결정을 짧고 변경 이력이 남는 문서로 관리한다.

## 상태

- `Proposed`: 논의 중이며 구현 기준이 아님
- `Accepted`: 현재 구현 기준
- `Superseded`: 더 최신 ADR로 대체됨
- `Deprecated`: 신규 구현에서 사용하지 않음

## 작성 규칙

파일명은 `NNNN-short-title.md` 형식을 사용한다. 각 ADR은 최소한 Context, Decision, Consequences를 포함한다. 기존 Accepted ADR의 결정을 바꿀 때 원문을 지우지 않고 새 ADR을 만들어 `Superseded` 관계를 남긴다.

## Index

- [ADR-0001: Spring Boot와 Python Agent 서비스 경계](0001-spring-python-service-boundary.md)
- [ADR-0002: PostgreSQL과 pgvector 통합 저장소](0002-postgresql-pgvector.md)
- [ADR-0003: MongoDB, Kafka, 운영 FAISS 제거](0003-remove-mongodb-kafka-faiss.md)
- [ADR-0004: Workspace-scoped RBAC](0004-workspace-scoped-rbac.md)
- [ADR-0005: Agent, Tool, MCP 경계](0005-agent-tool-mcp-boundary.md)
- [ADR-0006: 제한된 계층형 Supervisor](0006-bounded-hierarchical-supervisor.md)
- [ADR-0007: 웹 자료 탐색·수집 Provider 경계](0007-web-research-provider-boundary.md)
- [ADR-0008: Python Agent의 uv 프로젝트 관리](0008-python-agent-uv-project.md)
- [ADR-0009: 생성 Artifact의 검색 자격과 재귀 오염 방지](0009-generated-artifact-retrieval-safety.md) — Proposed
- [ADR-0010: Designer-first frontend 구현과 Vercel 배포](0010-designer-first-frontend-vercel.md)
- [ADR-0011: Spring Data JPA 기반 업무 데이터 영속화](0011-spring-data-jpa-persistence.md)
- [ADR-0012: 정책 Gate와 경량 분류기·LLM fallback을 결합한 Agent 라우팅](0012-hybrid-agent-routing-gateway.md) — Superseded
- [ADR-0013: Deep Agents를 부서 Agent 실행 하네스로 채택](0013-deep-agents-department-runtime.md)
- [ADR-0014: 단일 RAG의 RAPTOR 계층 검색](0014-raptor-single-rag.md)
- [ADR-0015: 운영 라우팅은 정책 Gate와 전 요청 LLM 평가를 사용](0015-llm-first-operational-routing.md)
- [ADR-0016: 초기 Runtime Compute를 Vultr로 통합](0016-vultr-first-runtime-deployment.md)
- [ADR-0017: Spring Backend의 Domain-first 패키지 구조](0017-domain-first-spring-packaging.md)
- [ADR-0018: Spring 소유 로컬 사용자 인증과 Refresh Token 회전](0018-local-user-authentication.md)
- [ADR-0019: 근거 기반 Immutable Quotation Revision](0019-immutable-grounded-quotation.md)
- [ADR-0020: Hibernate Vector 기반 PostgreSQL Hybrid Retrieval](0020-hibernate-vector-hybrid-retrieval.md)
- [ADR-0021: Spring 소유 Agent 감사·비용 원장](0021-agent-audit-and-cost-ledger.md)
- [ADR-0022: 발행 견적의 만료 가능한 Proposal 공유 링크](0022-expiring-proposal-share-links.md)
- [ADR-0023: Redis는 측정된 V3 필요 전까지 도입 유예](0023-defer-redis-until-measured-v3-need.md)
- [ADR-0024: Backend와 Agent의 독립 CI/CD](0024-independent-backend-agent-delivery.md)
- [ADR-0025: main CI 통과 후 자동 Production 배포](0025-main-ci-gated-automatic-production-delivery.md)
