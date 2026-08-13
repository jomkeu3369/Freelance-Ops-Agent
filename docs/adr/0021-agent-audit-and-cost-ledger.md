# ADR-0021: Spring 소유 Agent 감사·비용 원장

- 상태: Accepted
- 날짜: 2026-08-13

## Context

Python runtime state만으로는 고객에게 제시할 감사 기록과 과거 실행 비용을 안정적으로 보존할 수 없다.
현재 가격으로 과거 실행을 재계산하면 원가가 달라지고, Tool 입력·결과 전문 저장은 민감 정보 노출을 늘린다.

## Decision

Python Agent는 run별 request tier, model·Tool 호출 수, input·output·cached token, search credit,
crawled page, retry와 duration을 보고하고 resume에 걸쳐 누적한다.

Spring은 `app` schema에 다음 원장을 소유한다.

- `tool_execution`: Tool 이름, 입력 SHA-256, 안전한 결과 요약, status, error code와 latency
- `agent_interruption`: 질문, 사용자 답변과 pending/responded/cancelled 상태
- `model_pricing`: workspace별 provider/model 가격 version과 유효 기간
- `agent_run_usage`: 보고 사용량, 적용 가격 snapshot, 실제 비용과 billable outcome

Tool 입력·결과 전문과 비공개 chain-of-thought는 저장하지 않는다. 가격을 찾지 못한 실행은 비용을
추측하지 않고 `UNPRICED`로 기록한다. 비용은 Java `BigDecimal`로 계산한다.

## Consequences

- 과거 실행은 당시 적용된 가격 row를 FK로 보존해 재현할 수 있다.
- Tool 실행과 HITL 사용자 결정은 Spring 업무 감사 경계에서 조회할 수 있다.
- search/crawl의 단가 및 plan quota는 별도 pricing·quota 확장이 필요하다.
