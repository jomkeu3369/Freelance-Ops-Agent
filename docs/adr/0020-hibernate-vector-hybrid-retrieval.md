# ADR-0020: Hibernate Vector 기반 PostgreSQL Hybrid Retrieval

- 상태: Accepted
- 결정일: 2026-08-13

## Context

Knowledge와 Evidence Ledger는 Spring이 소유한 workspace 문서에서 근거 chunk를 검색해야 한다. 운영 FAISS는 제거하기로 했고 Python Agent가 Spring의 `app` schema를 직접 조회해서도 안 된다. 직접 SQL 중심 구현은 기존 ORM 결정과 충돌한다.

## Decision

- PostgreSQL `document`와 `document_chunk`가 원본 provenance, source version, jurisdiction, 효력일, content hash와 chunk offset을 저장한다.
- 초기 embedding dimension은 1536으로 고정하고 embedding model과 dimension을 함께 기록한다.
- Hibernate 공식 `hibernate-vector` 모듈의 `@JdbcTypeCode(SqlTypes.VECTOR)`와 `@Array(length=1536)`으로 pgvector를 ORM 매핑한다.
- PostgreSQL `TSVECTOR` full-text 후보와 `cosine_distance()` dense 후보를 각각 검색하고 raw score를 직접 합산하지 않는다.
- 두 순위는 Reciprocal Rank Fusion으로 결합한다. embedding이 없으면 lexical lane만 사용한다.
- 모든 query는 `workspace_id`와 ACTIVE document를 먼저 제한한다.
- Agent는 delegation token의 `agent.run`·`document.read`와 현재 DB permission을 모두 통과한 Spring internal Tool API만 호출한다.
- 검색 결과는 chunk와 document provenance를 함께 반환한다. Python Agent는 Spring business table을 직접 읽지 않는다.

## Consequences

- PostgreSQL 하나로 lexical·vector 검색과 업무 데이터 격리를 유지한다.
- Hibernate 공식 모듈을 사용해 vector column을 직접 SQL CRUD로 다루지 않는다.
- Docker가 실행되지 않은 현재 PC에서는 pgvector HQL과 Flyway의 실제 통합 검증이 skip되므로 Docker 환경에서 Testcontainers 재검증이 필수다.
- 1536 이외 embedding dimension 도입은 별도 index/table versioning 결정이 필요하다.
