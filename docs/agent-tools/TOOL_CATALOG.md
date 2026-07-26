# Freelance Ops Agent V2 Agent Tool Catalog

> 문서 상태: Draft v0.1
> 작성일: 2026-07-27
> 범위: Python Agent prototype와 향후 Spring Tool API가 공유할 Tool 책임·배치 기준

## 1. 목적

이 문서는 Freelance Ops Agent V2에서 필요한 Tool의 역할과 Supervisor 구조의
전문 Agent별 배치를 정의한다. 다음 세 파이프라인을 비교할 때 Tool 자체의
구현 차이가 실험 결과를 오염시키지 않도록 공통 기준으로 사용한다.

1. V1의 고정 Workflow
2. 모든 허용 Tool을 하나의 Agent에 연결한 단일 ReAct
3. 동일한 전체 Tool을 전문 Agent별로 나눈 단일 Supervisor

단일 ReAct와 Supervisor가 접근할 수 있는 **전체 기능의 합집합은 동일**해야
한다. Tool 이름, 입력·출력 schema, fixture, 문서 corpus와 오류 규칙은
고정하고, 어느 Agent에 Tool을 노출하는지만 변경한다.

## 2. 구현 단계

현재 Agent 구조 비교 단계에서는 필요한 Tool만 Python으로 구현한다.

| 단계 | 구현 방식 | 목적 |
|---|---|---|
| Agent 구조 비교 | Python in-memory/fixture Tool | Graph와 Tool 선택 성능 비교 |
| 검색 평가 | Python의 고정 문서 corpus | 검색 변동 없이 grounding 비교 |
| 외부 조사 평가 | Tavily·Crawl4AI adapter | 실제 웹 조사 품질 비교 |
| V2 서비스 통합 | Python Tool wrapper → Spring internal REST | RBAC·업무 규칙·DB 연결 |
| 선택적 확장 | 같은 계약의 MCP adapter | 외부 host와 connector 연동 |

Python prototype은 운영 업무 로직의 최종 소유자가 아니다. Spring 통합 후에는
단가, 견적, 권한, 영속화와 감사 기록을 Spring이 담당하고 Python Tool은
동일한 계약을 호출하는 adapter가 된다.

```text
현재: Agent Tool → Python Fixture/Deterministic Function
향후: Agent Tool → Spring HTTP Adapter → Spring Business Service
```

## 3. 공통 Tool 설계 원칙

- 같은 입력에는 같은 구조의 결과를 반환한다.
- Tool 내부에서 별도의 LLM을 호출하지 않는다.
- Golden Answer와 평가 label에 접근하지 않는다.
- `workspace_id` 같은 신뢰 경계 값은 모델이 임의로 선택하지 못하게 한다.
- 검색 결과에는 `source_id`, `chunk_id`, 원문과 source metadata를 포함한다.
- 계산 결과에는 입력, 계산식, policy version과 breakdown을 포함한다.
- read Tool과 write Tool을 구분한다.
- write Tool은 운영 단계에서 RBAC와 HITL 승인을 모두 통과해야 한다.
- Tool 오류, 빈 결과와 timeout을 구조화된 결과로 반환한다.
- Agent의 비공개 추론 대신 Tool trace, evidence, assumption과 오류를 기록한다.

## 4. 전문 Agent와 Tool 목록

### 4.1 Requirement Agent

사용자 요청의 누락·모순·모호함을 확인하고 견적 가능한 요구사항으로
구조화한다.

| Tool | 역할 |
|---|---|
| `get_project_context` | 현재 프로젝트의 제목, 설명과 기존 요구사항을 조회한다. |
| `search_similar_project_requirements` | 유사 사례에서 자주 등장하는 기능·사용자 유형·누락 후보를 찾는다. |
| `request_clarification` | 추가로 확인해야 할 질문과 `NEEDS_INPUT` 상태를 반환한다. |
| `validate_requirements` | 필수 정보 누락, 충돌과 측정 불가능한 표현을 검사한다. |

`search_similar_project_requirements`의 결과는 현재 요구사항에 자동으로
추가하지 않는다. 유사 사례는 정답이 아니라 질문 후보이며, 사용자의 확인을
거쳐야 현재 scope가 된다.

### 4.2 Research Agent

내부 문서와 필요한 외부 자료에서 인용 가능한 근거를 수집한다.

| Tool | 역할 |
|---|---|
| `list_documents` | 현재 run에서 접근 가능한 문서 목록과 metadata를 조회한다. |
| `search_documents` | 고정 corpus 또는 운영 검색 저장소에서 관련 chunk를 찾는다. |
| `read_document_chunks` | 선택한 chunk의 원문을 읽는다. |
| `search_similar_project_evidence` | 유사 사례의 요구사항·기술 선택 근거를 검색한다. |
| `web_search` | Tavily를 통해 외부 source 후보를 찾는다. |
| `crawl_url` | Crawl4AI로 선택한 페이지의 본문과 구조를 추출한다. |
| `fetch_document` | 공식 URL 또는 PDF 원문을 직접 수집한다. |

Agent 구조만 비교하는 첫 실험에서는 웹 결과의 변동을 막기 위해
`web_search`, `crawl_url`, `fetch_document`를 비활성화한다.

### 4.3 Risk Agent

계약, 지급, 개인정보, 저작권과 외부 서비스 정책 위험을 탐지한다.

| Tool | 역할 |
|---|---|
| `search_risk_evidence` | 법률·정책·약관 corpus에서 관련 근거를 찾는다. |
| `get_source_metadata` | 출처, 관할권, 발행일과 문서 버전을 확인한다. |
| `check_source_freshness` | 기준일에 유효한 최신 자료인지 검사한다. |
| `detect_transaction_risks` | 요구사항과 거래 조건에서 위험 신호를 탐지한다. |
| `check_contract_clauses` | 필요한 계약 조항의 존재 여부를 확인한다. |

Risk Agent는 법률 판단을 확정하지 않는다. 위험 category, severity, evidence와
`human_review_required`를 반환한다.

### 4.4 Estimation Agent

검증된 요구사항과 WBS를 이용해 작업량, 일정과 시급 기반 견적을 계산한다.

| Tool | 역할 |
|---|---|
| `search_similar_project_outcomes` | 유사 프로젝트의 실제 공수·기간·변경·결과를 조회한다. |
| `get_rate_card` | 직무별 시급과 통화 단위를 조회한다. |
| `get_estimation_policy` | Story Point 변환, buffer와 최소 금액 정책을 조회한다. |
| `calculate_effort` | WBS별 예상 시간 범위를 결정적으로 계산한다. |
| `calculate_schedule` | 작업 의존성과 가용 시간을 반영해 기간을 계산한다. |
| `calculate_quote` | 시급, 시간, buffer, 할인과 세금을 계산한다. |
| `compare_quote_scenarios` | 최소·권장·확장 시나리오를 같은 정책으로 비교한다. |

PoC의 Story Point-to-hour와 rate card는 실험용 policy라는 사실을 명시한다.
Story Point를 보편적인 금액으로 직접 변환하지 않는다.

### 4.5 Validation Agent

전문 Agent가 반환한 결과를 새로 작성하지 않고 누락·충돌·근거·계산 오류를
검사한다.

| Tool | 역할 |
|---|---|
| `validate_requirements` | 구조화된 요구사항의 누락과 충돌을 재검사한다. |
| `validate_wbs` | 작업 항목의 누락, 중복과 의존성 오류를 검사한다. |
| `validate_quote` | 공수, 단가, buffer, 세금과 합계를 검사한다. |
| `validate_evidence_coverage` | 주요 주장마다 evidence 또는 assumption이 있는지 검사한다. |
| `detect_result_conflicts` | 요구사항·조사·위험·견적 결과 사이 충돌을 찾는다. |
| `validate_deliverable` | 최종 출력 schema와 필수 field를 검사한다. |

Validation Agent는 수정된 결론을 임의로 생성하지 않고 구조화된 오류와
재실행 대상을 반환한다.

## 5. 유사 프로젝트 검색 Tool의 책임 분리

포괄적인 `search_similar_projects` 하나가 기능, 가격과 결과를 모두 반환하면
Requirement Agent가 과거 가격에 anchoring되거나 과거 기능을 현재 scope로
오인할 수 있다. 따라서 목적별로 분리한다.

| Tool | 사용 Agent | 공개하는 데이터 | 금지 용도 |
|---|---|---|---|
| `search_similar_project_requirements` | Requirement | 기능·사용자 유형·누락·질문 후보 | 기능 자동 추가, 가격 추정 |
| `search_similar_project_outcomes` | Estimation | 실제 공수·기간·금액·변경 횟수 | 요구사항 확정 전 견적 생성 |
| `search_similar_project_evidence` | Research | 관련 문서·기술 근거·source reference | 근거 없는 결론 생성 |

Requirement Agent에서 유사 프로젝트를 검색하는 목적은 과거 요구사항을
복사하는 것이 아니라 다음 확인 질문을 만들기 위해서다.

```text
유사 사례 검색
→ 흔한 기능과 누락 후보 발견
→ 사용자 확인 질문 생성
→ 확인된 항목만 현재 요구사항에 반영
```

## 6. ReAct와 Supervisor의 Tool 배치

### 6.1 단일 ReAct

하나의 Agent에 현재 실험에서 허용한 전체 Tool을 연결한다. Agent는 요청에
따라 Tool을 선택하지만 최대 호출 수, 실행 시간과 반복 호출 제한을 적용한다.

### 6.2 단일 Supervisor

Supervisor에는 업무 Tool을 직접 연결하지 않는다. Supervisor는 요청 분류,
전문 Agent 선택, 실행 순서, 결과 병합과 HITL 진입만 담당한다.

| 전문 Agent | Tool group |
|---|---|
| Requirement Agent | context, 유사 요구사항, 명확화, 요구사항 검증 |
| Research Agent | 내부 문서, 유사 근거, 웹 탐색·수집 |
| Risk Agent | 위험 근거, source metadata·freshness, 계약 위험 |
| Estimation Agent | 유사 outcome, rate card, 공수·일정·견적 계산 |
| Validation Agent | 요구사항·WBS·견적·evidence·최종 schema 검증 |

Supervisor가 검증된 계산이나 evidence를 자유롭게 재작성하지 못하게 한다.

## 7. 평가 단계별 최소 Tool set

### 7.1 BA-Agent-Bench

이 데이터셋은 요구사항 문서에서 BA-grade user story를 생성하는 평가이므로
견적·법률 Tool을 연결하지 않는다.

```text
list_documents
search_documents
read_document_chunks
validate_deliverable
```

### 7.2 프리랜서 개발 견적 PoC

한국 소프트웨어 개발 프리랜서의 요구사항·위험·시급 기반 견적 평가에는
다음 최소 set을 사용한다.

```text
get_project_context
search_similar_project_requirements
request_clarification
validate_requirements
list_documents
search_documents
read_document_chunks
search_risk_evidence
detect_transaction_risks
get_rate_card
calculate_effort
calculate_quote
validate_deliverable
```

## 8. 초기 실험에서 제외하는 Tool

다음은 DB, RBAC, 트랜잭션과 사용자 승인이 필요한 write Tool이므로 Agent
구조 비교가 끝난 뒤 Spring 통합 단계에서 구현한다.

```text
create_project_draft
create_requirement_revision
create_quote_draft
create_quote_revision
publish_quote
record_project_outcome
record_user_feedback
```

## 9. Agent Tool이 아닌 평가·보안 기능

다음 기능은 Agent가 선택하는 Tool로 만들지 않는다.

- latency와 token·API 비용 측정
- Golden Answer 비교와 LLM Judge
- hallucination·citation support 평가
- RBAC와 delegation token 검증
- timeout, retry와 최대 호출 수
- audit log와 model·prompt version 기록

이 항목은 평가 harness, Tool wrapper 또는 서버 middleware에서 강제한다.
