# Freelance Ops Agent V2 작업 인수인계

> 마지막 갱신: 2026-07-24
> 현재 branch: `main`
> 현재 단계: Phase 0 — 기준선과 아키텍처 확정

## 현재 목표

V2 구현에 들어가기 전에 기기와 Codex 세션이 바뀌어도 동일한 결정을 따를 수 있도록 명세, ADR, 작업 규칙과 인수인계 흐름을 확정한다.

## 완료

- V1 README와 실제 코드 구조 진단
- V2 제품·기술 명세 초안 작성
- PostgreSQL + pgvector 단일 운영 database 결정
- MongoDB, Kafka, 운영 FAISS 제거 결정
- workspace-scoped RBAC와 기본 role/permission matrix 설계
- Spring Boot 제품 backend와 FastAPI/LangGraph Agent 서비스 분리 결정
- OpenAI/Gemini API provider 지원 방향 결정
- 저장소 공통 작업 지침과 ADR 체계 추가
- 자유로운 swarm 대신 제한된 계층형 Supervisor 목표 구조 결정
- `Global Orchestrator → Department Supervisor → Specialist/Tool` 최대 2단계 경계 결정
- 단일 Agent baseline에서 품질이 입증된 부문만 Supervisor로 승격하는 원칙 결정
- Tavily, Crawl4AI, Direct HTTP/PDF를 분리하는 `WebResearchProvider` 경계 결정
- 공식 자료의 source registry, 불변 snapshot, 관할권·기준일·parser version 정책 결정
- 무료 제한, 건별 산출물과 quota 기반 구독을 조합한 초기 수익화 가설 수립
- run별 Agent·Tool·token·검색 credit·시간·원가 hard limit 명세

## 진행 중

- 문서 변경에 대한 사용자 검토
- V2 repository layout과 최초 scaffold 범위 결정
- 한국 소프트웨어 개발 프리랜서용 첫 domain/jurisdiction pack 범위 결정

## 다음 작업

1. 문서 변경을 검토하고 별도 feature branch에 commit한다.
2. V2 repository layout과 package naming을 확정한다.
3. `compose.v2.yaml`에 Spring, Agent, PostgreSQL의 최소 healthcheck 구성을 작성한다.
4. Spring Boot skeleton과 Flyway baseline을 생성한다.
5. FastAPI/LangGraph skeleton, internal OpenAPI contract와 공통 Agent state를 생성한다.
6. 요청 등급, run budget과 부문 structured result schema를 먼저 정의한다.
7. workspace, membership, role, permission의 첫 migration과 Testcontainers test를 작성한다.
8. 첫 web research benchmark에 사용할 공식 source corpus와 성공 기준을 정의한다.

## 현재 검증 상태

- V2 코드는 아직 scaffold되지 않았다.
- 현재 변경은 Markdown 문서이므로 build/test는 실행하지 않았다.
- 2026-07-24 갱신 문서의 Markdown 공백, ADR 내부 링크, 단계 번호, 미해결 marker와 핵심 결정 일관성을 확인했다.

## 열린 결정

- OpenAI와 Gemini 중 기본 evaluation provider
- chat model과 embedding model의 최초 고정 버전
- Spring Boot와 Spring Security의 최초 고정 버전
- Next.js frontend의 component system과 visual direction
- 첫 유료 검증 가격과 무료·유료 plan별 quota
- 한국 소프트웨어 개발 domain/jurisdiction pack의 공식 source corpus
- Tavily와 Crawl4AI benchmark의 test URL과 합격 기준
- 내부 Tool API를 MCP로 전환할 Phase 7의 구체적 범위

## 주의 사항

- `docs/`는 아직 Git에 commit되지 않은 상태일 수 있으므로 다른 컴퓨터에서 작업하기 전에 `git status`를 확인한다.
- 전체 대화 원문, 개인 일정, secret과 실제 고객 데이터는 공개 저장소에 올리지 않는다.
- 새 작업을 시작할 때 `AGENTS.md`, 이 문서, 관련 ADR과 V2 명세를 먼저 읽는다.
