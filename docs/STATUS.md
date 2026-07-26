# Freelance Ops Agent V2 작업 인수인계

> 마지막 갱신: 2026-07-27
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
- 멀티 에이전트 Supervisor 아키텍처 검토 완료
- 검토 결과와 필수 보완 사항을 [`docs/reviews/2026-07-24-multi-agent-supervisor-review.md`](reviews/2026-07-24-multi-agent-supervisor-review.md)에 기록
- Langflow prototype용 Global Orchestrator, 4개 Department Supervisor와 9개 Specialist의 system prompt 초안 작성
- Langflow Tool 연결, structured output, Tool description과 prompt 회귀 사례를 [`docs/agent-prompts/langflow-system-prompts-v1.md`](agent-prompts/langflow-system-prompts-v1.md)에 기록
- Langflow Global Orchestrator 하향식 테스트의 입력 배선, fake Tool과 실제 하위 flow 교체 순서를 prompt catalog에 기록
- Global Orchestrator smoke test용 정상·질문 필요·단순 계산·고위험 routing mock fixture를 prompt catalog에 기록
- GPT-5.6-terra Function Tool 호출 오류에 대한 `reasoning_effort=none` 설정을 prompt catalog에 기록
- 첫 routing smoke test에서 Langflow 내장 `Calculator`·`Current Date` Tool을 비활성화해야 한다는 점을 기록
- 모델 description은 선택사항이며, model profile·Tool 호환성·권장 Agent를 구분해 기록한다는 기준을 prompt catalog에 기록
- mock context를 실제 실행 context로 오인하지 않도록 Trusted Context Builder, State/Budget Builder와 Spring delegation token의 자동화 경계를 prompt catalog에 기록
- Global Agent 출력이 None일 때 Chat Output을 점검하는 최소 flow와 Department Tool Mode 전환 순서를 prompt catalog에 기록
- 총괄 Agent의 독단 응답을 막기 위한 강제 위임 prompt, 고유 Tool action slug와 검색·분석 순서 검증 기준을 prompt catalog에 기록
- Agent 표시 이름과 실제 Tool action slug의 차이, 중복 action 충돌과 mandatory delegation의 flow-level 강제 원칙을 prompt catalog에 기록
- Agent Tool의 역할, ReAct·Supervisor 배치와 단계별 최소 Tool set을 [`docs/agent-tools/TOOL_CATALOG.md`](agent-tools/TOOL_CATALOG.md)에 기록
- `search_similar_projects`를 요구사항·실제 outcome·근거 검색으로 분리하는 책임 경계 결정
- Agent 비교 단계의 Python fixture Tool과 운영 단계의 Spring Tool 구현 경계 기록

## 진행 중

- Supervisor 실행 계약 보완에 대한 사용자 검토
- Langflow system prompt `v0.1.0`과 Agent별 output schema 사용자 검토
- V2 repository layout과 최초 scaffold 범위 결정
- 한국 소프트웨어 개발 프리랜서용 첫 domain/jurisdiction pack 범위 결정

## 다음 작업

1. `test/.env`에 노출된 OpenAI·LangSmith 자격 증명을 폐기하고 원격 Git history secret scan을 실행한다.
2. Supervisor 리뷰의 P0 항목인 신뢰 context, 부문 contract, 병렬 병합과 중앙 budget 규칙을 명세에 반영한다.
3. Langflow에 단일 Agent baseline과 Global Orchestrator flow를 구성하고 fake Tool로 prompt 회귀 사례를 검증한다.
4. V2 repository layout과 package naming을 확정하고 별도 feature branch에서 작업한다.
5. `compose.v2.yaml`에 Spring, Agent, PostgreSQL의 최소 healthcheck 구성을 작성한다.
6. Spring Boot skeleton과 Flyway baseline을 생성한다.
7. FastAPI/LangGraph skeleton, internal OpenAPI contract와 분리된 `TrustedRunContext`·`WorkflowState`를 생성한다.
8. 요청 등급, run budget과 부문 structured result schema를 먼저 정의한다.
9. workspace, membership, role, permission의 첫 migration과 Testcontainers test를 작성한다.
10. 첫 web research benchmark에 사용할 공식 source corpus와 성공 기준을 정의한다.

## 현재 검증 상태

- V2 코드는 아직 scaffold되지 않았다.
- 2026-07-24 Supervisor 구조 검토에서는 live model 실험을 실행하지 않았다. 현재 `test/` 파일은 실제 API를 호출하고 assertion이 없는 실험 script이므로 자동 테스트 결과로 간주하지 않는다.
- 2026-07-24 갱신 문서의 Markdown 공백, ADR 내부 링크, 단계 번호, 미해결 marker와 핵심 결정 일관성을 확인했다.
- `test/.env`는 `.gitignore`에 의해 추적되지 않지만 실제 형식의 자격 증명이 있어 폐기와 재발급이 필요하다.
- 알려진 OpenAI·LangSmith 장기 token pattern과 `test/.env` 경로는 현재 Git history에서 발견되지 않았지만 전용 secret scanner 검증은 아직 필요하다.
- Langflow prompt는 문서 초안만 작성했으며 실제 flow 실행, structured output schema 호환성과 regression evaluation은 아직 수행하지 않았다.
- Tool Catalog의 Markdown 구조와 V2 명세 내부 링크를 검증했다.

## 열린 결정

- OpenAI와 Gemini 중 기본 evaluation provider
- chat model과 embedding model의 최초 고정 버전
- Spring Boot와 Spring Security의 최초 고정 버전
- Next.js frontend의 component system과 visual direction
- 첫 유료 검증 가격과 무료·유료 plan별 quota
- 한국 소프트웨어 개발 domain/jurisdiction pack의 공식 source corpus
- Tavily와 Crawl4AI benchmark의 test URL과 합격 기준
- 내부 Tool API를 MCP로 전환할 Phase 7의 구체적 범위
- `TrustedRunContext`와 mutable `WorkflowState`의 정확한 schema
- 병렬 부문 결과의 reducer, conflict와 partial failure 정책
- Spring 공개 상태와 LangGraph 내부 상태의 실패·재시도 mapping
- Phase 5 Research Supervisor 평가와 Phase 6 WebResearchProvider 구현 순서
- Langflow prototype에서 사용할 model, temperature, Agent iteration limit와 memory history 수
- Langflow Structured Response의 중첩 schema를 그대로 사용할지 Pydantic 검증 component를 추가할지 여부

## 주의 사항

- `docs/`는 아직 Git에 commit되지 않은 상태일 수 있으므로 다른 컴퓨터에서 작업하기 전에 `git status`를 확인한다.
- 두 Codex 환경에서 같은 branch를 동시에 수정하지 않고 작업별 feature branch를 사용한다.
- 전체 대화 원문, 개인 일정, secret과 실제 고객 데이터는 공개 저장소에 올리지 않는다.
- 새 작업을 시작할 때 `AGENTS.md`, 이 문서, 관련 ADR과 V2 명세를 먼저 읽는다.
