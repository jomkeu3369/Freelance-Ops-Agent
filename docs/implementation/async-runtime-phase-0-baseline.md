# Async Runtime 구현 Phase 0 기준선

> 기준일: 2026-08-31
> 범위: Deep Agent 비동기 실행, TaskAttempt telemetry, 사용자 제어, Scheduler 연결 전 기준선

## 1. 목적

새 비동기 Runtime을 기존 실행 경로 위에 단계적으로 추가하기 전에 현재 구현과 목표 설계의 차이를
고정한다. 기존 AgentRun 경로는 각 단계가 승격 기준을 통과할 때까지 운영 fallback으로 유지한다.

## 2. 검증 기준선

| 검증 | 결과 |
|---|---:|
| Agent pytest | 338 passed, 1 skipped |
| Agent Ruff | 통과 |
| Agent strict mypy | 58 source files 통과 |
| Backend Gradle test | 170 tests, 0 failures, 0 errors, 10 skipped |

Agent의 1개 skip은 별도 PostgreSQL integration URL이 필요한 테스트다. Backend skip은 현재 Gradle
테스트 suite에 선언된 조건부 테스트다. 새 구현은 위 결과보다 기존 통과 수를 줄이지 않는다.

## 3. 재사용할 현재 구현

- `AgentRunRequest`, `TrustedRunContext`, `RunBudget`, `ModelSelection`
- PostgreSQL `agent_run_state`와 append-only `agent_run_event`
- row lock 기반 AgentRun 상태 전이와 취소·재개 idempotency
- Spring `agent_run_command` durable command outbox와 lease 복구
- `task-attempt-telemetry-v1` event envelope, 금지 필드 검사와 idempotent event store
- 운영 routing의 Safety Gate, trusted contract fast path와 AD_HOC LLM evaluator
- Research Deep Agent의 run-scoped filesystem, 명시적 Tool과 범용 sub-agent 차단

## 4. 현재 공백

- `DepartmentTask`, `TaskAttempt`, `TaskCommand`, `TaskEvent`의 권위 있는 도메인 계약
- Task와 Attempt를 분리한 상태 전이와 revision 충돌 규칙
- Agent runtime schema의 정식 versioned migration
- Worker 실행과 TaskAttempt event emitter 연결
- Task 상태 변경과 event/outbox 기록의 원자적 transaction
- Queue 대기 작업과 실행 중 작업 모두에 적용되는 pause·redirect·cancel
- 실제 TaskAttempt log를 사용하는 shadow replay와 운영 Dispatcher

## 5. 구현 경계

1. Routing은 실행 경로를 결정하며 Scheduler가 route나 model을 바꾸지 않는다.
2. Global Orchestrator는 부서와 dependency를 결정하고 Deep Agents는 부서 내부에서만 실행한다.
3. Python Agent는 Spring 업무 테이블을 직접 읽거나 변경하지 않는다.
4. 권한, 예산, command, Task 상태와 외부 행동 결과는 cache하지 않는다.
5. Scheduler는 실제 telemetry shadow gate를 통과하기 전까지 운영 dispatch에 영향을 주지 않는다.
6. Redis는 측정된 PostgreSQL queue 또는 SSE 병목이 생기기 전까지 추가하지 않는다.

## 6. Phase 1 범위

Phase 1은 저장소나 Queue 구현 없이 순수 계약과 상태 전이 규칙만 추가한다.

- Task와 Attempt identifier, workspace, run, revision과 dependency
- Task·Attempt·Command 상태 enum
- 실행 전 permission·budget·model·Tool version snapshot
- 허용 상태 전이와 terminal 상태
- command expected revision과 idempotency key
- TaskEvent envelope과 secret·prompt·사고 과정 금지
- 불법 상태 전이, revision 충돌과 cross-workspace 입력에 대한 단위 테스트

Phase 1 계약이 통과한 뒤에만 Phase 2 PostgreSQL Task Registry migration을 작성한다.
