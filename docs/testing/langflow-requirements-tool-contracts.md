# Langflow 요구사항 분석 Tool 계약

> 작성일: 2026-07-27
> 목적: Agent의 역할과 ReAct Tool을 구분하고 Langflow에서 실제로 연결할 수 있는 형태를 정의한다.

## 1. Agent, Agent Tool, 업무 Tool의 차이

| 구분 | 판단 수행 | Langflow 형태 | 예시 |
|---|---:|---|---|
| Agent | 예 | Agent 컴포넌트 | Requirement Analyst |
| Agent Tool | 예 | Tool Mode가 활성화된 하위 Agent의 Toolset 출력 | `call_requirement_analyst` |
| 업무 Tool | 아니요 | Structured Tool, Custom Component 또는 internal REST wrapper | `get_project_context` |
| 실행 제어 | 아니요 | graph, middleware 또는 API boundary | 권한 검사, Budget Guard |

`analyze_requirements`는 원자적 업무 Tool이 아니다. Requirement Analyst라는 하위 Agent가 수행하는 능력이다. 다만 Supervisor 입장에서는 그 하위 Agent 전체를 `call_requirement_analyst`라는 하나의 Agent Tool로 호출할 수 있다.

## 2. Requirements Supervisor에 연결할 Agent Tool

### call_requirement_analyst

- 구현: Requirement Analyst Agent를 Tool Mode로 노출
- 호출자: Requirements Supervisor
- 책임: 입력된 요청과 허용된 context를 이용해 요구사항 초안을 생성
- 금지: 견적 계산, 웹 검색, 최종 승인

입력 예시:

```json
{
  "request_text": "쇼핑몰 관리자 페이지를 만들어 주세요.",
  "project_ref": "project-fixture-001",
  "domain": "ecommerce-admin",
  "run_context_summary_json": "{\"confirmed_facts\":[],\"previous_questions\":[],\"user_answers\":[]}"
}
```

출력 예시:

```json
{
  "status": "NEEDS_INPUT",
  "requirement_draft": {
    "goal": "쇼핑몰 운영자가 상품과 주문을 관리할 수 있는 관리자 페이지",
    "functional_requirements": [],
    "non_functional_requirements": [],
    "constraints": []
  },
  "gaps": [
    {
      "field": "roles",
      "reason": "관리자 권한 범위가 정의되지 않음",
      "blocking": true
    }
  ],
  "assumptions": [],
  "evidence_refs": [
    "user-message:current"
  ],
  "next_action": "ASK_CLARIFICATION"
}
```

### call_clarification_generator

- 구현: Clarification Generator Agent를 Tool Mode로 노출
- 호출자: Requirements Supervisor
- 책임: 분석 결과의 blocking gap을 최소 질문으로 변환
- 입력: Requirement Analyst의 구조화된 결과
- 출력: 질문 ID, 질문, 대상 field, 질문 이유와 우선순위
- strict function schema 호환을 위해 `requirement_analysis_json` 문자열과 `max_questions` 정수를 명시적으로 입력

첫 테스트에서는 질문 생성 Agent에 별도 업무 Tool을 연결하지 않는다.

## 3. Requirement Analyst에 연결할 ReAct 업무 Tool

### get_project_context

하나의 프로젝트에 대해 이미 확정된 정보만 조회한다.

```json
{
  "project_ref": "project-fixture-001"
}
```

```json
{
  "project_ref": "project-fixture-001",
  "version": 3,
  "confirmed_scope": [],
  "confirmed_constraints": [],
  "previous_answers": []
}
```

운영 구현에서는 인증된 Spring internal REST API를 호출한다. Tool이 임의로 요구사항을 생성하거나 요약하지 않는다.

### get_domain_rules

도메인별 필수 확인 항목과 용어 기준을 조회한다.

```json
{
  "domain": "ecommerce-admin",
  "ruleset_version": "v1"
}
```

```json
{
  "required_topics": [
    "사용자 역할",
    "상품 관리 범위",
    "주문 상태",
    "개인정보 처리",
    "감사 기록"
  ],
  "term_refs": [],
  "ruleset_version": "v1"
}
```

첫 테스트에서는 고정 fixture를 반환하고 이후 PostgreSQL 문서 저장소나 versioned configuration으로 교체한다.

### lookup_requirement_term

사용자의 표현이 여러 의미로 해석될 때만 용어 정의 후보를 조회한다.

```json
{
  "term": "실시간",
  "domain": "ecommerce-admin"
}
```

Tool은 의미를 선택하지 않고 가능한 정의와 구분 기준만 반환한다. 최종 선택은 Agent가 질문을 통해 사용자에게 확인한다.

### validate_requirement_draft

LLM이 만든 초안이 계약을 지키는지 결정적으로 검사한다.

```json
{
  "goal": "쇼핑몰 운영자가 상품과 주문을 관리할 수 있는 관리자 페이지",
  "functional_requirements": [],
  "non_functional_requirements": [],
  "constraints": [],
  "acceptance_criteria": []
}
```

```json
{
  "valid": false,
  "errors": [
    {
      "path": "functional_requirements",
      "code": "REQUIRED_FIELD_MISSING"
    }
  ],
  "warnings": []
}
```

이 Tool은 Pydantic 또는 JSON Schema 검증기로 구현한다. OpenAI strict function schema에서 `dict[str, Any]`가 속성 없는 object로 변환되는 것을 피하기 위해 다섯 입력 field를 명시적으로 노출한다. 문장을 개선하거나 누락된 값을 상상해서 채우지 않는다.

### check_requirement_conflicts

날짜 역전, 중복 ID, 상호 배타적인 enum처럼 코드로 판정할 수 있는 충돌만 검사한다. 의미적 모순을 전부 해결하는 Agent로 만들지 않는다.

## 4. Langflow 연결 방법

```text
Chat Input
  -> Requirements Supervisor
       Tools <- call_requirement_analyst Toolset
       Tools <- call_clarification_generator Toolset

call_requirement_analyst
  = Requirement Analyst Agent
       Tools <- get_project_context
       Tools <- get_domain_rules
       Tools <- lookup_requirement_term
       Tools <- validate_requirement_draft
```

하위 Agent 노드는 다음 기준으로 노출한다.

1. Agent 이름을 `call_requirement_analyst`, `call_clarification_generator`처럼 고유하게 지정한다.
2. 하위 Agent의 Tool Mode를 활성화한다.
3. Supervisor가 구조화된 인수인계를 받도록 가능하면 `CALL_AGENT_JSON_RESPONSE` 한 종류만 노출한다.
4. 하위 Agent의 Toolset 출력을 Supervisor의 `Tools` 입력에 연결한다.
5. 각 Tool description에는 호출 조건, 입력 의미, 반환값과 하지 않는 일을 기록한다.

업무 Tool은 Agent 노드로 만들지 않는다. Langflow Custom Component, Structured Tool 또는 Spring internal REST API wrapper로 구현하고 Requirement Analyst의 `Tools` 입력에 연결한다.

## 5. 최초 테스트 구성

처음에는 아래 구성만 사용한다.

```text
Requirements Supervisor
  - call_requirement_analyst
  - call_clarification_generator

Requirement Analyst
  - get_project_context
  - get_domain_rules
  - validate_requirement_draft

Clarification Generator
  - Tool 없음
```

`lookup_requirement_term`과 `check_requirement_conflicts`는 위 구성이 안정된 후 추가한다. 웹 검색과 유사 사례 검색은 요구사항 자체의 분석 능력 baseline을 측정한 다음 별도 실험으로 추가한다.

## 6. 잘못된 Tool 설계 징후

- Tool 이름이 `analyze`, `think`, `decide`, `make_better`처럼 내부 사고를 대신한다.
- Tool의 반환값이 호출할 때마다 크게 달라진다.
- 하나의 Tool이 조회, 판단, 수정과 저장을 동시에 수행한다.
- Tool description이 역할 설명뿐이고 입력과 출력 계약이 없다.
- 동일한 하위 Agent에서 message 응답과 JSON 응답 action을 동시에 노출해 Supervisor가 선택하기 어렵다.
- 인증, 권한 검사나 budget 제한을 LLM이 선택적으로 호출하게 한다.
