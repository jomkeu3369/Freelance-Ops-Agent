# Freelance Ops Agent V2 작업 인수인계

> 마지막 갱신: 2026-08-10
> 현재 branch: `main`
> 현재 단계: Phase 1 — Spring Boot 기반과 멀티테넌시

> 2026-08-06 메인 페이지 디자인 브리프(디자이너는 1920×1080 메인 페이지만 제작, 반응형·세부 화면은 Codex 담당): [`docs/frontend/MAIN_PAGE_DESIGN_BRIEF.md`](frontend/MAIN_PAGE_DESIGN_BRIEF.md)

## 현재 목표

Spring Boot의 workspace-scoped RBAC와 인증 경계를 완성하고, Client·Project CRUD의 모든 query가 `workspace_id`로 격리되는 기반을 만든다. Agent는 실행 사용자의 유효 permission만 delegation 받을 수 있어야 한다.

## 완료

- 2026-08-10: PostgreSQL 인프라를 `docker-compose-infra.yaml`, Agent·Backend를 `docker-compose.yaml`로 분리했다. 두 Compose project는 명시적인 `freelance-ops-v2-internal` external network를 공유하며 infra를 먼저 기동한다. CI와 로컬 실행 문서도 두 단계 검증으로 변경했다.
- 2026-08-10: Spring Boot 공개 API에 Springdoc OpenAPI 3과 Swagger UI를 추가했다. 기본 환경에서는 비활성화하고 Compose의 `development` profile에서만 활성화하며, `/api/**`만 문서화해 `contracts/openapi/`의 Agent 내부 계약과 분리했다. HTTP Basic 보안 scheme과 `/api/v1/meta` 문서를 추가했다.
- 2026-08-10: 다른 PC에서 작업을 이어가기 위한 [`로컬 Compose 및 Swagger 작업 인수인계`](operations/local-compose-and-swagger-handoff.md)를 작성했다. 전체 Compose 기동 명령, 당시 Swagger 구현 전 상태, 보안 원칙과 다음 작업 순서를 기록했으며 이후 Springdoc 구현 상태로 갱신했다.

- 2026-08-09: `backend/`, `agent/`, `frontend/`, `contracts/`, `infra/` V2 최상위 구조를 확정하고 관련 명세와 ADR-0008의 Python Agent 경로를 `agent/`로 정정했다.
- 2026-08-09: Spring Boot 4.1.0·Java 21·Gradle 9.6.1 기반 backend와 Gradle Wrapper, Spring Security deny-by-default 골격, Actuator health, Flyway `app` schema baseline과 Agent health indicator를 구성했다.
- 2026-08-09: Python 3.12·FastAPI 0.139.2·LangGraph 1.2.9 기반 독립 uv project와 lock file을 구성했다. 요청 등급과 `max_departments`에 따라 최대 4개 부서를 순차 호출하는 제한형 Supervisor graph baseline을 추가했다.
- 2026-08-09: Spring→Agent run API와 Agent→Spring Tool API를 versioned OpenAPI 3.1 계약으로 분리했다. 계약에는 trusted context, provider/model 선택, run budget, 부서 structured result와 resume 흐름이 포함된다.
- 2026-08-09: PostgreSQL + pgvector, 내부 전용 Agent, 외부 진입점 Spring의 초기 단일 Compose를 구성했다. 2026-08-10 infra와 application Compose로 분리했으며 `app_user`와 `agent_user`, `app`과 `agent_runtime` schema 분리 및 Agent port 비공개 원칙은 유지한다.
- 2026-08-09: backend·agent·contract·compose·image build를 검사하는 V2 CI workflow를 추가했다. 실제 배포 대상과 secret이 정해지지 않아 CD 배포 단계는 아직 연결하지 않았다.
- 2026-08-09: `user_account`, `workspace`, `workspace_member`, `permission`, `workspace_role`, `role_permission`, `member_role`, `rbac_audit_event`의 Flyway migration을 추가했다. membership과 role에 `workspace_id` 복합 외래키를 적용해 DB 수준에서도 cross-workspace role 할당을 거부한다.
- 2026-08-09: 31개 안정 permission code와 5개 기본 system role matrix를 구현했다. workspace 생성자는 같은 transaction에서 OWNER membership과 전체 기본 role을 생성받는다.
- 2026-08-09: 활성 membership의 여러 role permission을 합산하는 JPA adapter와 중앙 authorization service를 구현했다. membership 부재·cross-workspace resource는 `NOT_FOUND`, 같은 workspace의 권한 부족은 `FORBIDDEN`으로 판정하고 거부 결과를 audit에 기록한다.
- 2026-08-09: Spring 애플리케이션 코드의 직접 SQL을 Spring Data JPA Repository로 전환했다. Flyway가 schema를 소유하고 Hibernate는 `ddl-auto=validate`만 수행하며, workspace 조회 조건과 DB 복합 외래키를 함께 유지한다. 결정 근거는 ADR-0011에 기록했다.
- 2026-08-09: 마지막 OWNER 보호, ADMIN의 OWNER 변경 차단, 자기 권한 상승 차단 policy와 Spring method security를 추가했다.
- 2026-08-09: 루트의 V1 `src_temp`, Poetry, MongoDB·Kafka Compose와 과거 배포 workflow를 `legacy/v1/`로 이동했다. 과거 workflow는 `.github/workflows` 밖에 보존해 자동 실행되지 않는다.
- 2026-08-09: 혼재하던 `test/`와 `tests/`를 제거하고 추적 가능한 prototype은 `experiments/`, 로컬 notebook·FAISS 산출물은 Git에서 제외되는 `experiments/local_archive/`로 이동했다. 서비스 자동 테스트는 `backend/src/test`, `agent/tests`, `frontend/tests`만 사용한다.
- 2026-08-09: `.gitignore`의 광범위한 `tests/` 규칙이 `agent/tests`까지 제외하던 문제를 수정하고 V2 CI의 중복 push·PR 실행을 `main` push와 pull request로 정리했다.

- 2026-08-06: 메인 페이지 디자인 브리프를 V2 명세와 README에 맞춰 전면 보강했다. Header부터 Footer까지 각 섹션의 목적, 실제 문구, 화면 내용, 시각 방향과 근거 문서를 같은 형식으로 정리하고, 첫 출시 범위를 한국 소프트웨어 개발 프리랜서로 수정했다. 가짜 후기·고객사·성능 수치, 미확정 가격과 “모든 직군 지원” 표현은 사용 금지 콘텐츠로 명시했다.
- `frontend/`에 React 19 + TypeScript + vinext 기반 V2 프런트엔드 콘셉트를 구성했다. Project Intake를 중심으로 고객 원문과 AI 초안의 구분, 12-column gapless bento, 요구사항 accordion, workflow card stacking, 사용자 후기와 CTA를 구현했다.
- 라이트 `Paper Studio`와 다크 `Night Workshop` 테마를 `next-themes`로 제공하고, GSAP ScrollTrigger reveal·scrub·pin motion 및 reduced-motion 대체 동작을 적용했다.
- 소셜 공유 이미지와 Open Graph/Twitter metadata를 추가했다. 배포 시 `NEXT_PUBLIC_SITE_URL`로 공개 origin을 지정한다.
- 프런트엔드 검증 기준으로 `npm run typecheck`, `npm run lint`, `npm test`를 구성했다.
- 한글 UI 글꼴을 프로젝트에 자체 포함된 `Pretendard Variable`로 교체하고 영문 라벨·숫자는 Geist 계열을 유지했다. 한글 헤드라인의 자간과 행간도 가변 글꼴 기준으로 조정했다.
- frontend 작업 방식을 designer-first workflow로 변경했다. 사용자가 레퍼런스 2~3개를 선정하고, Codex가 V2 문서를 디자이너용 자료로 정리하며, 웹디자이너의 1920×1080 HTML·CSS·JavaScript handoff를 Codex가 Next.js·React·TypeScript와 반응형으로 변환한다.
- frontend 배포 기준을 Vercel Preview 검수 후 승인된 revision의 Production 배포로 확정하고 [ADR-0010](adr/0010-designer-first-frontend-vercel.md)과 [`docs/frontend/DESIGN_IMPLEMENTATION_WORKFLOW.md`](frontend/DESIGN_IMPLEMENTATION_WORKFLOW.md)에 기록했다.

- 생성 데이터 재학습의 model collapse와 V2의 RAG corpus 오염을 구분해 검토하고, 초안 격리, retrieval eligibility gate, root provenance, source pool, lineage dedup, index snapshot·rollback과 fine-tuning 차단 방안을 [`docs/reviews/2026-07-29-generated-artifact-recursion-risk-review.md`](reviews/2026-07-29-generated-artifact-recursion-risk-review.md)에 기록했다. 구현 결정은 [ADR-0009](adr/0009-generated-artifact-retrieval-safety.md) Proposed 상태로 사용자 검토를 기다린다.
- V2 Python Agent를 `agent`의 독립적인 uv project로 관리하고 `pyproject.toml`과 `uv.lock`을 dependency 기준으로 사용하는 결정을 [ADR-0008](adr/0008-python-agent-uv-project.md)에 기록했다. `legacy/v1` Poetry project는 V1·prototype 기준선으로 보존한다.
- 완성된 Supervisor를 가정한 Agent·Tool·재시도별 run 실제 원가, route별 사용 횟수 기반 월 비용, 성공 산출물당 원가와 Budget Guard 계산식을 [`docs/operations/supervisor-usage-cost-model.md`](operations/supervisor-usage-cost-model.md)에 기록했다.
- 요구사항 분석 단일 ReAct Stage 1에 `get_project_context`, `get_domain_pack`, `validate_requirement_draft` fixture Tool을 적용하고, 각 Tool의 run당 1회 호출 제한과 최종 구조화 결과의 상태 일관성 검증을 추가했다. 구현 경계와 검증 결과는 [`docs/testing/requirements-analysis-tool-plan.md`](testing/requirements-analysis-tool-plan.md)에 기록했다.
- 현재 요구사항 평가 파이프라인의 dataset 준비, ReAct·Supervisor 내부 실행, 3개 LLM Judge, LangSmith trace와 결과 집계 흐름을 Mermaid graph로 평가 문서에 기록했다.
- Hugging Face `nguyenminh871/software_requirements`를 검토해 61행·3개 text 열의 183개 고유 요청을 확인했고, 정답 label이 없어 원본 상태로는 정확도 benchmark가 될 수 없으며 수작업 label을 추가한 보조 stress dataset으로만 사용하는 판단을 평가 문서에 기록했다.
- LangSmith `ExperimentResults`를 구조별 전체 평균, case 통과율, Judge별 평균과 실패 case로 집계해 터미널 표와 timestamp JSON 보고서로 출력하는 기능을 추가했다.
- `validate_requirement_draft(draft: dict[str, Any])`가 OpenAI strict function schema에서 속성 없는 object로 변환되던 문제를 해결하기 위해 요구사항 초안의 다섯 field를 명시적 Tool 인자로 변경했다.
- Supervisor Agent Tool의 `dict[str, Any]` 입력도 같은 schema 오류를 내지 않도록 `run_context_summary_json`, `requirement_analysis_json` 문자열 계약과 명시적 Pydantic args schema로 변경했다.
- 빈 Judge별 모델 환경변수가 OpenAI에 `model=""`으로 전달되던 문제를 수정하고 prototype, Judge, timeout, retry와 LangSmith project 설정에서 빈 값을 기본값으로 처리하도록 통합했다.
- ReAct 요구사항 분석 prototype과 Requirements Supervisor prompt 초안을 `experiments/requirements/`에 보존했다. 과거 문서에서 설명한 LLM-as-Judge와 LangSmith evaluator 파일은 현재 tree에 없어 복구 또는 재구현이 필요하다.
- prototype 실행 방법, 환경변수, LangSmith 확인 항목과 평가 주의사항을 `docs/testing/requirements-prototype-evaluation.md`에 기록했다.
- 요구사항 분석 테스트에서 Agent 역할, Supervisor용 Agent Tool과 ReAct 업무 Tool을 구분하고 Langflow 연결 및 JSON 계약 예시를 `docs/testing/langflow-requirements-tool-contracts.md`에 기록했다.
- Langflow Desktop 검증에서 별도 Department flow를 `Run Flow` Tool로 Global Orchestrator에 연결하는 절차, action slug·Tool Mode·입력 배선·Tool trace 합격 기준과 `langchain-openai` 실행 환경 점검을 [`docs/testing/langflow-global-orchestrator-runbook.md`](testing/langflow-global-orchestrator-runbook.md)에 기록했다.

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
- Supervisor·ReAct 요구사항 분석 검증을 위한 P0/P1/P2 Tool, fixture와 단계별 합격 기준을 [`docs/testing/requirements-analysis-tool-plan.md`](testing/requirements-analysis-tool-plan.md)에 기록
- Agent Tool의 역할, ReAct·Supervisor 배치와 단계별 최소 Tool set을 [`docs/agent-tools/TOOL_CATALOG.md`](agent-tools/TOOL_CATALOG.md)에 기록
- `search_similar_projects`를 요구사항·실제 outcome·근거 검색으로 분리하는 책임 경계 결정
- Agent 비교 단계의 Python fixture Tool과 운영 단계의 Spring Tool 구현 경계 기록

## 진행 중

- ADR-0009의 생성 artifact lifecycle, 검색 자격과 재귀 오염 방지 정책에 대한 사용자 검토
- Supervisor의 실제 provider 호출, 부서별 Tool, checkpoint와 중앙 budget enforcement 구현
- Spring 인증 principal과 delegation token 구현
- Langflow system prompt `v0.1.0`과 Agent별 output schema 사용자 검토
- 한국 소프트웨어 개발 프리랜서용 첫 domain/jurisdiction pack 범위 결정

## 다음 작업

### 다음 PC에서 우선 수행

- `main`을 pull한 뒤 [`로컬 Compose 및 Swagger 작업 인수인계`](operations/local-compose-and-swagger-handoff.md)에 따라 V2 image build와 전체 Compose 기동을 검증한다.
- Docker 환경에서 JPA 기반 PostgreSQL Testcontainers 통합 테스트 4건을 skip 없이 재실행한다.
- 개발 profile에서 `/swagger-ui.html`과 `/v3/api-docs`를 열고, HTTP Basic 인증 후 `/api/v1/meta` 호출을 검증한다.

### 이후 backlog

1. `experiments/local_archive/**/.env`에 남아 있는 자격 증명을 폐기하고 원격 Git history secret scan을 실행한다. 해당 파일은 Git에서 제외한다.
2. ADR-0009를 검토·승인한 뒤 artifact status, provenance, lineage, retrieval eligibility와 index snapshot contract를 V2 명세에 반영한다.
3. Spring이 audience-bound delegation token을 발급하고 Agent가 이를 검증하는 internal authentication을 구현한다.
4. Client·Project CRUD에 중앙 authorization service와 workspace-scoped repository query를 적용한다.
5. provider·model·Tool·환율의 첫 `pricing_snapshot` schema와 route별 `estimated_cost`·`actual_cost` 집계 contract를 정의한다.
6. `react_v1.py` Stage 1을 10~20개 고정 fixture와 LangSmith 평가로 실행해 Tool 호출 순서, 요구사항 누락률, 질문 품질과 불필요 호출률을 측정한다.
7. Langflow에 단일 Agent baseline과 Global Orchestrator flow를 구성하고 fake Tool로 prompt 회귀 사례를 검증한다.
8. 사용자가 frontend 레퍼런스 사이트 2~3개와 참고·제외 요소를 전달한다.
9. Codex가 `DESIGN_BRIEF.md`, `CONTENT_MATRIX.md`, `SCREEN_SPECIFICATION.md`, `COMPONENT_INVENTORY.md`, `INTERACTION_GUIDE.md`, `DESIGN_HANDOFF_CHECKLIST.md`를 작성한다.
10. 웹디자이너의 1920×1080 handoff가 준비되면 React·TypeScript 변환과 반응형 구현 범위를 확정한다.
11. 첫 Agent run endpoint를 구현하고 Spring→Agent contract test를 연결한다.
12. Requirements Department에 read-only Spring Tool client와 구조화 출력 validation을 구현한다.
13. PostgreSQL `agent_runtime` schema에 LangGraph checkpoint persistence를 연결한다.
14. 실제 staging 대상, image registry와 secret manager를 확정한 뒤 CD workflow를 추가한다.
15. 첫 web research benchmark에 사용할 공식 source corpus와 성공 기준을 정의한다.

## 현재 검증 상태

- 2026-08-10: Springdoc OpenAPI 3.0.3 추가 후 backend 테스트 20건 중 16건이 통과했고 실패는 없었다. Docker를 사용할 수 없어 PostgreSQL Testcontainers 4건은 skip됐다. OpenAPI metadata와 HTTP Basic security scheme 단위 테스트는 통과했지만 실제 Swagger endpoint 기동은 아직 검증하지 않았다.
- 2026-08-09: Agent에서 `uv sync --locked`, pytest 3건, Ruff와 strict mypy를 통과했다. FastAPI TestClient의 `httpx2` 전환 예고 경고 1건은 upstream 호환성 추적 대상으로 남겼다.
- 2026-08-09: Spring source compile과 JUnit test를 통과했다. 현재 PC의 한글 사용자·프로젝트 경로에서는 Gradle test worker classpath 오류가 재현됐으며, ASCII drive와 전용 cache를 사용하면 `BUILD SUCCESSFUL`을 확인했다. Linux CI에는 해당 우회가 필요하지 않다.
- 2026-08-09: 두 OpenAPI 3.1 문서를 `openapi-spec-validator`로 검증했고 당시 단일 Compose config 검증을 통과했다. 2026-08-10 image build는 성공했지만 PostgreSQL·Agent health 실패로 전체 기동은 완료되지 않았으며, 원인 분리를 위해 Compose를 infra와 application으로 나눴다.
- 2026-08-09: Docker Desktop을 기동하고 Testcontainers 2.0.5의 PostgreSQL 17에서 Flyway migration, permission seed, 기본 role provisioning, cross-workspace 복합 FK와 접근 거부 audit 기록을 검증했다. RBAC matrix·인가·불변조건을 포함한 backend 테스트 17건이 실패·skip 없이 통과했다.

- 2026-08-05: frontend designer-first workflow, 1920×1080 handoff, React·TypeScript 변환, responsive 기준과 Vercel Preview/Production gate를 V2 명세, Accepted ADR-0010과 frontend 작업 문서에 반영했다.
- 2026-08-05: 현재 `frontend/` prototype에서 `npm run typecheck`, `npm run lint`, `npm test`를 통과했다. 이 prototype은 최종 visual source of truth가 아니며 웹디자이너 handoff 이후 교체될 수 있다.
- 2026-07-29: 생성 자료 재사용 위험 검토에서 고전적 model collapse의 학습 조건과 V2 inference-time RAG를 구분하고, Proposed ADR-0009와 상세 검토 문서의 상대 링크, lifecycle, P0 방어 항목과 V2 불변조건의 일관성을 확인했다. 실제 corpus contamination benchmark는 아직 실행하지 않았다.
- 2026-07-29: 당시 `src/agent` directory skeleton만 존재해 실행 가능한 scaffold로 간주하지 않았다. 이 상태는 2026-08-09 `agent/` uv project와 lock file 생성으로 해소됐다.
- 2026-07-28: Supervisor 비용 모델의 route별 월 변동비, 성공 산출물당 변동비·완전 원가와 20% guardrail 예시 산술을 재계산했고 V2 명세와 STATUS의 내부 문서 경로를 확인했다. 실제 Provider 단가는 입력하지 않았으며 향후 `pricing_snapshot`에서 versioning한다.
- 2026-07-28: 사용자의 Poetry Python 3.12 환경에서 `react_v1.py` source compile, 세 업무 Tool과 최종 `RequirementsAnalysis`의 OpenAI strict schema, fixture 결정성, `SUCCESS`·`EMPTY`, validator의 `VALID`·`INVALID`·`INVALID_JSON` 분기와 Agent graph 생성을 통과했다. 실제 OpenAI/LangSmith 호출은 실행하지 않았다.
- 2026-07-27: 사용자의 Poetry Python 3.12 환경에서 가짜 LangSmith `ExperimentResultRow`로 Judge 평균, case 통과율, 실패 case, 우수 구조 선택, 터미널 표 출력과 JSON 직렬화 회귀 검사를 통과했다.
- 2026-07-27: 사용자의 Poetry Python 3.12 환경에서 `validate_requirement_draft`, `call_requirement_analyst`, `call_clarification_generator`의 OpenAI strict Tool schema를 검사했다. 모든 schema가 전체 properties를 required에 포함하고 `additionalProperties=false`를 만족했으며 ReAct·Supervisor graph 생성과 검증 Tool 직접 호출을 통과했다.
- 2026-07-27: 사용자의 Poetry Python 3.12 환경에서 Judge별 model, 공통 model, reasoning effort, timeout, retry와 LangSmith project를 빈 문자열로 설정한 회귀 검사를 통과했다. Judge는 `gpt-5.6-luna`, prototype은 `gpt-5.6-terra`, LangSmith project는 평가 기본값으로 정상 fallback했다.
- 2026-07-27: Python source compile과 JSONL 3건 parsing을 통과했고, `poetry.lock`의 LangChain 1.1.0, LangGraph 1.0.4, LangChain OpenAI 1.1.0, LangSmith 0.4.52 조합으로 두 graph, 세 Judge와 세 업무 Tool의 import 및 생성 검증을 통과했다. 실제 OpenAI/LangSmith 호출은 비용과 credential 사용이 필요해 실행하지 않았다.

- V2 frontend prototype은 repository에 포함할 준비가 되었지만 최종 visual source of truth는 아니다. Python Agent와 Spring backend는 실행 가능한 foundation 단계이며 workspace RBAC는 구현됐지만 실제 인증·Client·Project CRUD·LLM provider·Tool 구현은 아직 없다.
- 2026-07-24 Supervisor 구조 검토에서는 live model 실험을 실행하지 않았다. 현재 `experiments/` 파일은 실제 API를 호출하거나 assertion이 없는 실험 script이므로 자동 테스트 결과로 간주하지 않는다.
- 2026-07-24 갱신 문서의 Markdown 공백, ADR 내부 링크, 단계 번호, 미해결 marker와 핵심 결정 일관성을 확인했다.
- `experiments/local_archive/**/.env`는 `.gitignore`에 의해 추적되지 않지만 실제 형식의 자격 증명이 있어 폐기와 재발급이 필요하다.
- 알려진 OpenAI·LangSmith 장기 token pattern과 local archive 경로는 현재 Git history에서 발견되지 않았지만 전용 secret scanner 검증은 아직 필요하다.
- Langflow prompt는 문서 초안만 작성했으며 실제 flow 실행, structured output schema 호환성과 regression evaluation은 아직 수행하지 않았다.
- 2026-08-03: 실행 중인 Langflow Desktop backend가 `1.10.0`이고 전용 Python 환경에서 `langchain-openai 1.4.1` import 및 health/version endpoint가 정상임을 확인했다. 화면의 `No module named langchain_openai` 오류는 현재 저장소 Poetry 환경이 아니라 Desktop build/cache 또는 별도 LFX 실행 환경을 우선 점검해야 하는 상태이며, 실제 Global Orchestrator의 Department Tool 호출 trace는 아직 확인하지 않았다.
- Tool Catalog의 Markdown 구조와 V2 명세 내부 링크를 검증했다.

- 2026-08-09: 구조 정리 후 `agent/tests`의 pytest 3건, Ruff, MyPy와 `frontend/tests`의 Node 테스트 2건, TypeScript typecheck, ESLint를 통과했다. Compose V2 설정도 유효하다.
- 2026-08-09: frontend 의존성 설치 결과 npm audit 기준 취약점 20건(낮음 1, 보통 4, 높음 15)이 남아 있다. 자동 강제 수정은 breaking change 위험 때문에 수행하지 않았으며 CI 정비 단계에서 직접 검토한다.

- 2026-08-09: JPA 전환 후 backend 단위 테스트 15건은 통과했다. Docker Desktop이 중지된 상태여서 PostgreSQL Testcontainers 통합 테스트 4건은 skip되었으며 Docker 기동 후 재검증이 필요하다.

## 열린 결정

- ADR-0009 생성 artifact lifecycle, retrieval eligibility gate, source quota와 synthetic lineage 제한의 승인 여부
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
