# ADR-0001: Spring Boot와 Python Agent 서비스 경계

- 상태: Accepted
- 결정일: 2026-07-21

## Context

V2는 기업형 backend 역량과 Python Agent 생태계를 모두 활용해야 한다. Spring Boot만 사용하면 LangGraph의 checkpoint, HITL과 평가 자산을 포기하게 되고, FastAPI 하나만 사용하면 이번 V2에서 의도한 Spring Security, 관계형 domain, transaction과 Java portfolio의 비중이 낮아진다.

두 runtime을 단순히 나누면 RBAC 중복, business DB의 공동 소유, 분산 transaction과 장애 처리가 새로운 복잡성이 된다.

## Decision

- Spring Boot를 public product backend이자 business system of record로 사용한다.
- FastAPI + LangGraph를 Docker 내부 전용 AI runtime으로 사용한다.
- frontend는 Spring API만 호출한다.
- Spring은 인증, RBAC, CRM, 프로젝트, 견적, evidence 영속화와 audit를 소유한다.
- Python은 model provider, prompt, graph, ReAct loop, HITL checkpoint와 AI evaluation을 소유한다.
- Python은 business table을 직접 읽거나 변경하지 않고 Spring internal Tool API를 호출한다.
- Spring은 사용자 권한을 검증한 뒤 짧은 수명의 delegation token을 Agent에 전달한다.
- public Agent run 상태는 Spring이 저장하고 상세 LangGraph checkpoint는 `agent_runtime` schema에 저장한다.
- 서비스 계약은 versioned OpenAPI와 구조화 DTO로 관리한다.

## Consequences

장점:

- Java business backend와 Python Agent를 각 생태계의 강점에 맞게 사용한다.
- Agent가 Spring transaction과 RBAC를 우회하지 못한다.
- OpenAI와 Gemini provider 변경이 Python Agent 내부에 격리된다.
- AI runtime의 독립적인 test와 평가가 가능하다.

비용:

- service-to-service 인증, timeout, idempotency와 distributed tracing이 필요하다.
- Docker service와 contract test가 증가한다.
- Spring의 제품 상태와 LangGraph runtime 상태를 correlation ID로 연결해야 한다.

## Rejected alternatives

- FastAPI 단일 backend: 더 단순하지만 V2의 Spring backend 목표를 충족하지 않는다.
- Spring AI 단일 runtime: 운영은 단순하지만 LangGraph를 활용하려는 목표와 기존 Agent 자산의 재사용성이 낮다.
- Python의 business DB 직접 접근: 권한과 transaction 경계를 무너뜨리므로 거부한다.
