# Freelance Ops Agent V2 작업 인수인계

> 마지막 갱신: 2026-07-29
> 현재 branch: `main`
> 현재 단계: Phase 0 — 기준선과 아키텍처 확정

## 현재 목표

V2 구현에 들어가기 전에 기기와 Codex 세션이 바뀌어도 동일한 결정을 따를 수 있도록 명세, ADR, 작업 규칙과 인수인계 흐름을 확정한다.

## 완료

- 생성 데이터 재학습의 model collapse와 V2의 RAG corpus 오염을 구분해 검토하고, 초안 격리, retrieval eligibility gate, root provenance, source pool, lineage dedup, index snapshot·rollback과 fine-tuning 차단 방안을 [`docs/reviews/2026-07-29-generated-artifact-recursion-risk-review.md`](reviews/2026-07-29-generated-artifact-recursion-risk-review.md)에 기록했다. 구현 결정은 [ADR-0009](adr/0009-generated-artifact-retrieval-safety.md) Proposed 상태로 사용자 검토를 기다린다.
- V2 Python Agent를 `src/agent`의 독립적인 uv project로 관리하고 `pyproject.toml`과 `uv.lock`을 dependency 기준으로 사용하는 결정을 [ADR-0008](adr/0008-python-agent-uv-project.md)에 기록했다. 루트 Poetry project는 V1·prototype 기준선으로 보존한다.
- 완성된 Supervisor를 가정한 Agent·Tool·재시도별 run 실제 원가, route별 사용 횟수 기반 월 비용, 성공 산출물당 원가와 Budget Guard 계산식을 [`docs/operations/supervisor-usage-cost-model.md`](operations/supervisor-usage-cost-model.md)에 기록했다.
- 요구사항 분석 단일 ReAct Stage 1에 `get_project_context`, `get_domain_pack`, `validate_requirement_draft` fixture Tool을 적용하고, 각 Tool의 run당 1회 호출 제한과 최종 구조화 결과의 상태 일관성 검증을 추가했다. 구현 경계와 검증 결과는 [`docs/testing/requirements-analysis-tool-plan.md`](testing/requirements-analysis-tool-plan.md)에 기록했다.
- 현재 요구사항 평가 파이프라인의 dataset 준비, ReAct·Supervisor 내부 실행, 3개 LLM Judge, LangSmith trace와 결과 집계 흐름을 Mermaid graph로 평가 문서에 기록했다.
- Hugging Face `nguyenminh871/software_requirements`를 검토해 61행·3개 text 열의 183개 고유 요청을 확인했고, 정답 label이 없어 원본 상태로는 정확도 benchmark가 될 수 없으며 수작업 label을 추가한 보조 stress dataset으로만 사용하는 판단을 평가 문서에 기록했다.
- LangSmith `ExperimentResults`를 구조별 전체 평균, case 통과율, Judge별 평균과 실패 case로 집계해 터미널 표와 timestamp JSON 보고서로 출력하는 기능을 추가했다.
- `validate_requirement_draft(draft: dict[str, Any])`가 OpenAI strict function schema에서 속성 없는 object로 변환되던 문제를 해결하기 위해 요구사항 초안의 다섯 field를 명시적 Tool 인자로 변경했다.
- Supervisor Agent Tool의 `dict[str, Any]` 입력도 같은 schema 오류를 내지 않도록 `run_context_summary_json`, `requirement_analysis_json` 문자열 계약과 명시적 Pydantic args schema로 변경했다.
- 빈 Judge별 모델 환경변수가 OpenAI에 `model=""`으로 전달되던 문제를 수정하고 prototype, Judge, timeout, retry와 LangSmith project 설정에서 빈 값을 기본값으로 처리하도록 통합했다.
- ReAct 요구사항 분석 prototype, Requirements Supervisor prototype, 완전성·근거성·확인 질문 품질을 평가하는 3개 LLM-as-Judge와 LangSmith dataset/experiment 로깅 모듈을 `test/prototypes/`, `test/evaluation/`에 추가했다.
- prototype 실행 방법, 환경변수, LangSmith 확인 항목과 평가 주의사항을 `docs/testing/requirements-prototype-evaluation.md`에 기록했다.
- 요구사항 분석 테스트에서 Agent 역할, Supervisor용 Agent Tool과 ReAct 업무 Tool을 구분하고 Langflow 연결 및 JSON 계약 예시를 `docs/testing/langflow-requirements-tool-contracts.md`에 기록했다.

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
- 현재 uncommitted worktree에서 V1 `src/*` 정리와 `src/agent`, `src/backend` V2 directory skeleton 구성이 진행 중이다. 이번 uv 결정 기록에서는 해당 사용자 변경을 수정하지 않았다.
- Supervisor 실행 계약 보완에 대한 사용자 검토
- Langflow system prompt `v0.1.0`과 Agent별 output schema 사용자 검토
- V2 repository layout과 최초 scaffold 범위 결정
- 한국 소프트웨어 개발 프리랜서용 첫 domain/jurisdiction pack 범위 결정

## 다음 작업

1. `test/.env`에 노출된 OpenAI·LangSmith 자격 증명을 폐기하고 원격 Git history secret scan을 실행한다.
2. ADR-0009를 검토·승인한 뒤 artifact status, provenance, lineage, retrieval eligibility와 index snapshot contract를 V2 명세에 반영한다.
3. `src/agent/pyproject.toml`, `src/agent/uv.lock`과 고정 Python runtime을 정의하고 uv project의 최소 import·pytest 검증을 구성한다.
4. Supervisor 리뷰의 P0 항목인 신뢰 context, 부문 contract, 병렬 병합과 중앙 budget 규칙을 명세에 반영한다.
5. provider·model·Tool·환율의 첫 `pricing_snapshot` schema와 route별 `estimated_cost`·`actual_cost` 집계 contract를 정의한다.
6. `react_v1.py` Stage 1을 10~20개 고정 fixture와 LangSmith 평가로 실행해 Tool 호출 순서, 요구사항 누락률, 질문 품질과 불필요 호출률을 측정한다.
7. Langflow에 단일 Agent baseline과 Global Orchestrator flow를 구성하고 fake Tool로 prompt 회귀 사례를 검증한다.
8. V2 repository layout과 package naming을 확정하고 별도 feature branch에서 작업한다.
9. `compose.v2.yaml`에 Spring, Agent, PostgreSQL의 최소 healthcheck 구성을 작성한다.
10. Spring Boot skeleton과 Flyway baseline을 생성한다.
11. FastAPI/LangGraph skeleton, internal OpenAPI contract와 분리된 `TrustedRunContext`·`WorkflowState`를 생성한다.
12. 요청 등급, run budget과 부문 structured result schema를 먼저 정의한다.
13. workspace, membership, role, permission의 첫 migration과 Testcontainers test를 작성한다.
14. 첫 web research benchmark에 사용할 공식 source corpus와 성공 기준을 정의한다.

## 현재 검증 상태

- 2026-07-29: 생성 자료 재사용 위험 검토에서 고전적 model collapse의 학습 조건과 V2 inference-time RAG를 구분하고, Proposed ADR-0009와 상세 검토 문서의 상대 링크, lifecycle, P0 방어 항목과 V2 불변조건의 일관성을 확인했다. 실제 corpus contamination benchmark는 아직 실행하지 않았다.
- 2026-07-29: `src/agent`의 directory skeleton은 존재하지만 `pyproject.toml`과 `uv.lock`은 아직 없으므로 uv sync·pytest를 실행 가능한 scaffold로 간주하지 않았다. ADR-0008, V2 명세, STATUS와 AGENTS의 경로·도구 결정 일관성만 검증했다.
- 2026-07-28: Supervisor 비용 모델의 route별 월 변동비, 성공 산출물당 변동비·완전 원가와 20% guardrail 예시 산술을 재계산했고 V2 명세와 STATUS의 내부 문서 경로를 확인했다. 실제 Provider 단가는 입력하지 않았으며 향후 `pricing_snapshot`에서 versioning한다.
- 2026-07-28: 사용자의 Poetry Python 3.12 환경에서 `react_v1.py` source compile, 세 업무 Tool과 최종 `RequirementsAnalysis`의 OpenAI strict schema, fixture 결정성, `SUCCESS`·`EMPTY`, validator의 `VALID`·`INVALID`·`INVALID_JSON` 분기와 Agent graph 생성을 통과했다. 실제 OpenAI/LangSmith 호출은 실행하지 않았다.
- 2026-07-27: 사용자의 Poetry Python 3.12 환경에서 가짜 LangSmith `ExperimentResultRow`로 Judge 평균, case 통과율, 실패 case, 우수 구조 선택, 터미널 표 출력과 JSON 직렬화 회귀 검사를 통과했다.
- 2026-07-27: 사용자의 Poetry Python 3.12 환경에서 `validate_requirement_draft`, `call_requirement_analyst`, `call_clarification_generator`의 OpenAI strict Tool schema를 검사했다. 모든 schema가 전체 properties를 required에 포함하고 `additionalProperties=false`를 만족했으며 ReAct·Supervisor graph 생성과 검증 Tool 직접 호출을 통과했다.
- 2026-07-27: 사용자의 Poetry Python 3.12 환경에서 Judge별 model, 공통 model, reasoning effort, timeout, retry와 LangSmith project를 빈 문자열로 설정한 회귀 검사를 통과했다. Judge는 `gpt-5.6-luna`, prototype은 `gpt-5.6-terra`, LangSmith project는 평가 기본값으로 정상 fallback했다.
- 2026-07-27: Python source compile과 JSONL 3건 parsing을 통과했고, `poetry.lock`의 LangChain 1.1.0, LangGraph 1.0.4, LangChain OpenAI 1.1.0, LangSmith 0.4.52 조합으로 두 graph, 세 Judge와 세 업무 Tool의 import 및 생성 검증을 통과했다. 실제 OpenAI/LangSmith 호출은 비용과 credential 사용이 필요해 실행하지 않았다.

- V2 directory skeleton은 현재 uncommitted worktree에 있으나 Python과 Spring build file이 없는 초기 단계다.
- 2026-07-24 Supervisor 구조 검토에서는 live model 실험을 실행하지 않았다. 현재 `test/` 파일은 실제 API를 호출하고 assertion이 없는 실험 script이므로 자동 테스트 결과로 간주하지 않는다.
- 2026-07-24 갱신 문서의 Markdown 공백, ADR 내부 링크, 단계 번호, 미해결 marker와 핵심 결정 일관성을 확인했다.
- `test/.env`는 `.gitignore`에 의해 추적되지 않지만 실제 형식의 자격 증명이 있어 폐기와 재발급이 필요하다.
- 알려진 OpenAI·LangSmith 장기 token pattern과 `test/.env` 경로는 현재 Git history에서 발견되지 않았지만 전용 secret scanner 검증은 아직 필요하다.
- Langflow prompt는 문서 초안만 작성했으며 실제 flow 실행, structured output schema 호환성과 regression evaluation은 아직 수행하지 않았다.
- Tool Catalog의 Markdown 구조와 V2 명세 내부 링크를 검증했다.

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
