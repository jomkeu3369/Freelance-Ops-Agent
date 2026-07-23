# ADR-0006: 제한된 계층형 Supervisor

- 상태: Accepted
- 결정일: 2026-07-24

## Context

V2의 장기 목표는 다양한 직군, 거래 방식과 관할권을 지원하는 것이다. 하나의 Agent에 모든 prompt, 문서와 Tool을 제공하면 context가 비대해지고 책임과 평가 경계가 불명확해진다. 반대로 직군·국가마다 Agent를 만들거나 Agent가 자유롭게 서로 handoff하는 swarm을 사용하면 routing 오류, 순환 실행, 비용, 권한 추적과 재현성이 악화된다.

## Decision

- 핵심 견적 흐름은 상태 기반 LangGraph workflow로 유지한다.
- 목표 구조는 `Global Orchestrator → Department Supervisor → Specialist Agent 또는 결정적 Tool`의 최대 2단계 계층이다.
- 부문은 요구사항, 조사, 거래 설계, 검증으로 구분하되, 첫 구현에서 모든 부문을 별도 Supervisor로 만들지 않는다.
- Global Orchestrator는 직접 전문 결론을 재작성하지 않고 요청 등급 분류, 부문 선택, 결과 조정과 HITL 진입만 담당한다.
- Department Supervisor는 자기 영역의 최소 Tool만 사용한다. 부문끼리 직접 호출하지 않고 Global Orchestrator를 통해 협력한다.
- 조직도와 허용 transition은 코드로 고정하고, 실행할 부문만 상태와 정책에 따라 동적으로 선택한다.
- 단순 조회·계산은 Agent를 거치지 않는다. 요청은 `DIRECT_TOOL`, `SINGLE_AGENT`, `DEPARTMENT`, `MULTI_DEPARTMENT`, `HUMAN_REQUIRED` 중 하나로 분류한다.
- 사용자 대화의 단계 전환에는 제한된 state-driven handoff를 사용할 수 있지만, 핵심 견적 처리에 자유로운 swarm을 사용하지 않는다.
- 최대 계층 깊이, model·Tool 호출 수, token, 검색 credit, 실행 시간, retry와 handoff 횟수를 run budget으로 강제한다.
- 각 부문 결과는 자연어 대화가 아니라 versioned structured output으로 반환하며 evidence, assumption, unresolved question, risk와 validation 상태를 포함한다.
- 단일 Agent + Tool을 baseline으로 유지하고, 계층형 구조가 품질·비용 평가에서 우월한 부문만 승격한다. 첫 승격 후보는 조사 부문이다.

## Consequences

장점:

- 전문 context와 Tool 권한을 부문별로 격리할 수 있다.
- 요구사항, 조사, 견적과 검증 결과를 독립적으로 평가할 수 있다.
- 서로 독립적인 조사는 병렬 실행할 수 있다.
- 사용자에게 위임 흐름과 근거를 설명하기 쉬워진다.

비용:

- graph state, structured result contract와 trace가 복잡해진다.
- 중복 context 전송과 다중 model 호출로 비용과 latency가 증가할 수 있다.
- routing, 순환, 부문 간 결과 충돌을 별도로 평가해야 한다.

## Rejected alternatives

- 단일 거대 Agent만 사용: 초기 baseline으로는 유지하지만 장기적인 전문화와 context 격리에 부족하다.
- 직군·국가별 Agent를 무제한 추가: prompt와 routing 조합이 폭증하므로 domain/jurisdiction pack으로 대체한다.
- 자유로운 swarm: 핵심 업무의 재현성, 권한과 비용 통제가 어려워 거부한다.
- Supervisor가 전문 결과를 자유롭게 재작성: 검증된 계산과 근거를 훼손할 수 있으므로 거부한다.
