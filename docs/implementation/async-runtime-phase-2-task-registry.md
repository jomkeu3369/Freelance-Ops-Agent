# Async Runtime 구현 Phase 2 Task Registry

> 기준일: 2026-08-31
> 상태: 구현 및 로컬 검증 완료, PostgreSQL CI 검증 대기

## 1. 소유권 경계

`app.agent_task`, `app.agent_task_dependency`, `app.agent_task_attempt`는 Spring이 소유하는
권위 있는 Task Registry다. 인증된 사용자 상태 조회, revision 판정, 현재 attempt, heartbeat와
향후 command 처리는 이 저장소를 기준으로 한다.

Python의 `agent_runtime.agent_task`와 `agent_runtime.agent_task_attempt`는 Agent 실행·checkpoint와
TaskAttempt telemetry를 원자적으로 연결하기 위한 실행 저장소다. Spring 업무 테이블을 직접 읽지
않으며 공개 상태나 권한 판정의 권위가 아니다. 두 저장소 간 전달은 이후 command/event outbox의
idempotent 계약으로 연결한다.

## 2. Spring Task Registry

- `agentrun`과 같은 `client`, `controller`, `dto/request`, `dto/response`, `entity`, `model`,
  `repository`, `security`, `service` 패키지 구조를 사용한다.
- task, dependency, attempt와 workspace/run scope를 Flyway `V28`로 생성한다.
- task revision과 현재 attempt 번호를 row lock과 optimistic version으로 보호한다.
- attempt 번호는 `(task_id, task_revision, attempt_number)`에서 유일하다.
- hard redirect는 현재 attempt를 `SUPERSEDED`로 만든 뒤 revision을 증가시킨다.
- 이전 revision 또는 attempt의 결과는 현재 Task 상태에 병합하지 않는다.
- heartbeat는 task와 attempt identity, workspace, revision과 현재 attempt 번호가 모두 일치할 때만
  phase와 activity를 갱신한다.
- Agent service API 초안의 task 등록과 heartbeat endpoint를 제공한다.

## 3. Python 실행 저장소

- Alembic이 `agent_runtime` baseline, task, attempt와 append-only task event table을 관리한다.
- 운영 startup은 `create_all`을 호출하지 않고 migration table 존재를 검증한다.
- Task와 Attempt 전이는 PostgreSQL row lock 안에서 수행한다.
- 동일 identity의 재전송은 idempotent하고, 다른 payload 또는 attempt 번호 충돌은 명시적으로
  거부한다.
- Docker entrypoint와 Agent CI가 API·테스트 시작 전에 `alembic upgrade head`를 실행한다.

## 4. 검증 결과

| 검증 | 결과 |
|---|---:|
| Agent pytest | 361 passed, 2 skipped |
| Agent Ruff | 통과 |
| Agent strict mypy | 60 source files 통과 |
| Alembic upgrade/downgrade offline SQL | 통과 |
| Backend Gradle test | 통과 |

로컬 Agent skip 2건은 PostgreSQL integration URL이 필요한 재시작·Task Registry 테스트다.
PR에서는 Agent CI PostgreSQL service와 Backend Testcontainers로 migration, 실제 transaction,
동시 전이와 제약을 검증한 뒤에만 Phase 2를 병합한다.
