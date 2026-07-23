# ADR-0005: Agent, Tool, MCP 경계

- 상태: Accepted
- 결정일: 2026-07-21

## Context

V1은 고정된 LLM node가 검색과 견적을 순차 수행한다. V2는 ReAct 방식의 Tool 선택을 도입하되, 가격 계산과 business write를 LLM에 맡기거나 모든 내부 기능을 처음부터 MCP로 노출해서는 안 된다.

## Decision

- Python LangGraph가 Agent graph와 Tool 선택 loop를 담당한다.
- Spring Boot가 검색, 단가 조회, 견적 계산과 draft 생성의 실제 Tool 구현을 담당한다.
- 초기 서비스 간 Tool 계약은 인증된 internal REST/OpenAPI로 구현한다.
- 핵심 흐름과 권한 모델이 안정된 뒤 같은 Tool 계약을 Spring MCP server로 확장할 수 있다.
- Google Drive, Calendar, Notion 같은 외부 connector에도 MCP를 선택적으로 사용한다.
- 금액과 일정 합산은 결정적 Java Tool에서 수행한다.
- write Tool과 외부 변경 Tool은 RBAC와 HITL 승인을 모두 요구한다.
- model의 비공개 chain-of-thought 대신 Tool trace, source, 계산식과 assumption을 저장한다.

## Consequences

- Agent 자율성과 business 안전 경계를 동시에 유지한다.
- REST와 MCP schema의 중복을 피하기 위해 공통 Tool DTO와 contract test가 필요하다.
- MCP는 V2 핵심 flow의 선행 조건이 아니며 Phase 7까지 장애 격리를 유지한다.
