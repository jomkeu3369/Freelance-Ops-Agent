# 요구사항 분석 Agent Tool 테스트 계획

> 작성일: 2026-07-27
> 대상: Requirements Supervisor, Requirement Analyst, Clarification Generator
> 목적: Supervisor 구조와 ReAct 구조의 요구사항 분석 능력을 단계적으로 검증

## 1. 검증 원칙

- 처음에는 웹 검색, RAG, 견적 계산과 write Tool을 제외한다.
- Tool이 없는 단일 Agent를 baseline으로 먼저 측정한다.
- Supervisor가 호출하는 하위 Agent Tool과 Specialist가 사용하는 업무 Tool을 구분한다.
- 권한, budget, trace와 checkpoint는 모델이 선택하는 Tool이 아니라 실행 계층에서 강제한다.
- 각 Tool은 하나의 책임과 versioned input/output schema를 가진다.
- fixture Tool은 동일 입력에 항상 동일 결과를 반환한다.

## 2. 권장 구조

```text
Global Orchestrator
└─ Requirements Supervisor
   ├─ analyze_requirements
   │  └─ Requirement Analyst
   │     ├─ get_project_context
   │     ├─ get_domain_pack
   │     ├─ lookup_requirement_term
   │     └─ validate_requirement_draft
   ├─ generate_clarification_questions
   │  └─ Clarification Generator
   └─ validate_requirement_result
```

## 3. P0 필수 Tool

### Supervisor가 호출하는 Agent Tool

| Tool | 종류 | 목적 | 호출 조건 |
|---|---|---|---|
| `analyze_requirements` | Agent Tool | 원문을 목표, 기능, 비기능 요구사항, 제약, 의존성, 수락 기준과 공백으로 구조화 | 새 요청 또는 사용자 답변으로 요구사항이 변경됨 |
| `generate_clarification_questions` | Agent Tool | blocking gap을 사용자가 답할 수 있는 최소 질문으로 변환 | 분석 결과가 `NEEDS_INPUT` |
| `validate_requirement_result` | 결정적 Tool | 출력 schema, 필수 field, ID와 reference 무결성 검사 | 분석 또는 질문 생성 결과를 반환하기 전 |

### Requirement Analyst가 사용하는 ReAct Tool

| Tool | 종류 | 입력 | 출력 | 역할 |
|---|---|---|---|---|
| `get_project_context` | read Tool | `project_ref` | 기존 요청, 사용자 답변, 프로젝트 제약과 version | 사용자가 이미 제공한 정보를 중복 질문하지 않게 함 |
| `get_domain_pack` | read Tool | `domain`, `pack_version` | 업종별 필수 정보, WBS 용어, 질문 기준과 범위 | 일반 지식이 아니라 versioned 기준으로 completeness를 평가 |
| `lookup_requirement_term` | read Tool | `term`, `domain` | 승인된 용어 정의와 구분 기준 | “관리자”, “실시간”, “대규모” 같은 모호한 용어 해석 보조 |
| `validate_requirement_draft` | 결정적 Tool | 구조화된 requirement draft | field 오류, 중복 ID, 누락 reference와 enum 오류 | LLM 출력이 contract를 만족하는지 검사 |

### Clarification Generator Tool

첫 테스트에서는 Tool을 주지 않는다. Requirement Analyst 결과만 입력받아 질문 생성 능력을 독립적으로 평가한다.

## 4. P1 보완 Tool

P0 테스트가 안정된 뒤 추가한다.

| Tool | 목적 | 추가 이유 |
|---|---|---|
| `get_acceptance_criteria_template` | 요구사항 유형별 수락 기준 template 조회 | 질문과 수락 기준의 구체성 개선 |
| `check_obvious_conflicts` | 날짜, 수치, 상호 배타 enum 등 결정적으로 확인 가능한 충돌 탐지 | LLM의 충돌 누락 보완 |
| `get_workspace_delivery_policy` | 지원 기간, 배포 책임, 기본 제외 범위 등 workspace 정책 조회 | 사용자별 견적 전제 반영 |
| `get_integration_catalog` | 승인된 외부 연동의 요구 정보와 알려진 제약 조회 | API·인증·데이터 의존성 질문 개선 |
| `compare_requirement_versions` | 이전 version과 현재 version의 추가·삭제·변경 항목 비교 | HITL 답변 이후 재분석 검증 |

## 5. P2 검색 Tool

순수 요구사항 분석 평가가 끝난 뒤 추가한다.

| Tool | 목적 | 제한 |
|---|---|---|
| `search_similar_requirements` | 과거 승인 프로젝트에서 자주 누락된 요구사항 후보 탐색 | 후보는 assumption 또는 질문으로만 사용 |
| `search_domain_knowledge` | 내부 승인 문서에서 업종별 제약 검색 | source ID 필수 |
| `search_policy_signals` | 개인정보·결제·플랫폼 정책 검토가 필요한 신호 검색 | 법률 결론을 반환하지 않음 |

웹 검색은 Requirements 단계의 기본 Tool로 두지 않는다. 최신 외부 근거가 필요하다는 신호만 Research Supervisor에 반환한다.

## 6. 테스트 전용 fixture Tool

| Tool | 목적 |
|---|---|
| `fixture_project_context` | 사용자 답변 유무, 기존 제약과 version이 고정된 프로젝트 context 반환 |
| `fixture_domain_pack` | 한국 소프트웨어 개발용 고정 domain pack 반환 |
| `fixture_requirement_validator` | 의도적으로 정상 또는 schema 오류를 반환 |
| `fixture_timeout` | Tool timeout과 retry 제한 검증 |
| `fixture_permission_denied` | 권한 부족 시 Agent가 추측으로 진행하지 않는지 검증 |

fixture Tool은 운영 Tool과 동일한 schema를 사용하고 adapter만 교체한다.

## 7. Tool로 만들지 않을 항목

다음 항목은 LLM이 호출 여부를 선택하면 안 된다.

| 항목 | 실행 위치 |
|---|---|
| delegation token 검증 | Agent API middleware |
| workspace·permission 강제 | Spring authorization과 Tool endpoint |
| model·Tool 호출 budget | 중앙 Budget Guard |
| trace·token·latency 기록 | observability middleware |
| checkpoint 저장·복원 | LangGraph checkpointer |
| Agent transition allowlist | graph routing code |
| structured output 최종 검증 | graph edge 또는 API boundary |

## 8. 단계별 테스트

### Stage 0 — 단일 Agent baseline

- Tool 없음
- 동일 fixture 10~20건 분석
- completeness, 누락률, 잘못 만든 assumption과 질문 품질 측정

### Stage 1 — ReAct 최소 구성

- `get_project_context`
- `get_domain_pack`
- `validate_requirement_draft`

기대 동작:

```text
context 조회
→ domain 기준 조회
→ requirement draft 생성
→ schema 검증
→ 완료 또는 수정
```

### Stage 2 — Requirements Supervisor

- `analyze_requirements`
- `generate_clarification_questions`
- `validate_requirement_result`

기대 동작:

```text
analyze_requirements
→ READY이면 validate_requirement_result
→ INCOMPLETE이면 generate_clarification_questions
→ validate_requirement_result
```

### Stage 3 — 실패와 제한

- timeout
- permission denied
- schema mismatch
- 동일 Tool 반복
- budget 소진
- 모순된 사용자 답변

Agent가 자체 지식으로 실패를 숨기지 않고 `BLOCKED`, `NEEDS_INPUT` 또는 `HUMAN_REQUIRED`를 반환해야 한다.

### Stage 4 — 검색 보강

P2 검색 Tool을 추가하고 baseline 대비 요구사항 누락률이 실제로 줄어드는지 비교한다.

## 9. 첫 구현 권장 목록

처음 Langflow에 구현할 Tool은 아래 6개면 충분하다.

```text
analyze_requirements
generate_clarification_questions
validate_requirement_result
get_project_context
get_domain_pack
validate_requirement_draft
```

첫 테스트에서 제외:

```text
web_search
calculate_effort
calculate_quote
create_quote_draft
external_write
```

## 10. 합격 기준

- READY·NEEDS_INPUT routing accuracy
- 필수 요구사항 field 누락률
- 원문에 없는 requirement 생성률
- 이미 답한 질문 반복률
- blocking question precision
- Tool 호출 순서 준수율
- 불필요한 Tool 호출률
- schema validation 통과율
- timeout·permission 오류의 안전한 종료율
- 동일 입력의 route 안정성

