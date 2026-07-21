# ADR-0002: PostgreSQL과 pgvector 통합 저장소

- 상태: Accepted
- 결정일: 2026-07-20

## Context

V1은 MongoDB와 로컬 FAISS index를 분리해 사용한다. 이 구조는 업무 데이터와 vector metadata의 transaction, 멀티테넌시 필터, 동시 쓰기, backup과 참조 무결성을 일관되게 보장하기 어렵다.

## Decision

- PostgreSQL을 유일한 운영 database로 사용한다.
- pgvector를 document chunk embedding 검색에 사용한다.
- Spring business table은 `app` schema, LangGraph checkpoint는 `agent_runtime` schema에 둔다.
- 서비스별 DB credential과 schema 권한을 분리한다.
- 초기 데이터에서는 exact vector search를 사용하고 benchmark가 필요성을 입증할 때 HNSW를 추가한다.
- 원본 파일은 개발 환경의 volume, 운영 환경의 S3-compatible storage에 두고 metadata만 PostgreSQL에 저장한다.

## Consequences

- 업무 데이터, evidence와 vector source를 transaction 및 foreign key로 연결할 수 있다.
- workspace filter를 일반 SQL과 vector 검색에 동일하게 적용할 수 있다.
- 운영 database 수가 줄어든다.
- embedding model 변경과 re-index migration을 명시적으로 관리해야 한다.
