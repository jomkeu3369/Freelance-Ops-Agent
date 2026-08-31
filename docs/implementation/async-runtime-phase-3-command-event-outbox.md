# Async Runtime 구현 Phase 3 Command/Event Outbox

> 기준일: 2026-08-31
> 상태: 구현 및 로컬 검증 완료, PostgreSQL CI 검증 대기

## 1. 구조와 소유권

Spring 코드는 기존 `agentrun` 도메인의 구조와 관례를 기준으로 `agenttask`의 `controller`,
`dto/request`, `dto/response`, `entity`, `model`, `repository`, `service`에 배치한다. Spring의
`app.agent_task_command`와 `app.agent_task_event`가 사용자 명령 원본과 공개 상태 이벤트의
권위 있는 저장소다. Python의 `agent_runtime.agent_task_event`는 실행 상태와 같은 transaction에서
생성되는 전달 Outbox다.

## 2. Spring command Outbox

- command 원본과 전달 상태를 `agent_task_command`, `agent_task_command_delivery`로 분리한다.
- command 원본은 데이터베이스 trigger로 update를 차단한다.
- `(workspace_id, task_id, idempotency_key)`가 같은 정확한 재전송은 기존 command ID를 반환한다.
- 같은 idempotency key의 다른 요청은 충돌로 거부한다.
- 전달 claim에는 lease와 attempt fencing을 적용해 만료된 worker의 늦은 ACK가 새 claim을 완료하지
  못하게 한다.
- 업무 상태 변경과 command enqueue가 한 transaction에 있어야 하도록 enqueue는 기존
  `AgentRunCommandQueue`와 동일하게 `Propagation.MANDATORY`를 사용한다.

## 3. Agent event Outbox와 Spring projection

- Python event 계약에 `task_revision`, `phase`, `milestone`을 포함하고 task/attempt ID를 UUID로
  고정한다.
- attempt 상태 전이와 event/outbox insert를 같은 PostgreSQL transaction에서 수행할 수 있다.
- publisher는 row lease로 batch를 claim하고 Spring ingestion API의 명시적 event ID ACK만 완료한다.
- 전송 실패와 누락 ACK는 제한된 지수 backoff 후 재시도하며, claim attempt fencing으로 늦은 ACK를
  무시한다.
- Spring은 event ID, source ID와 attempt sequence를 중복 제거하고 전체 identity가 같은 경우에만
  idempotent 성공으로 처리한다.
- 이전 task revision의 event는 감사 원장에 남지만 현재 Task/Attempt projection은 변경하지 않는다.
- event payload에서 secret, delegation token, prompt와 chain-of-thought key를 재귀적으로 거부한다.

## 4. 상태 투영 규칙

| Event | Attempt projection | Task projection |
|---|---|---|
| `attempt.started` | `RUNNING` | 현재 revision이면 `RUNNING` |
| `attempt.checkpointed` | `CHECKPOINTED` | 공개 phase/milestone만 갱신 |
| `attempt.completed` | `COMPLETED` | `COMPLETED` 또는 `COMPLETED_REUSED` |
| `attempt.failed` | `FAILED` | 최종 retry 판정 전에는 terminal로 만들지 않음 |
| 이전 revision event | 변경 없음 | 변경 없음 |

## 5. 검증 기준

- Spring entity/service 단위 테스트: exact idempotency, lease fencing, 현재/이전 revision 투영
- Agent 단위 테스트: event identity, 금지 필드, delivery claim/ACK/retry, HTTP batch 계약
- 실제 PostgreSQL CI: Alembic migration, attempt 전이와 event Outbox 원자성, Flyway 제약
- 전체 Backend/Agent 회귀, Ruff와 strict mypy

로컬 검증 결과는 Agent `363 passed, 2 skipped`, Backend `182 tests, 0 failures, 11 skipped`다.
Agent Ruff와 61개 source file strict mypy, Alembic upgrade/downgrade offline SQL도 통과했다.
로컬 skip은 Docker가 없는 환경에서 실제 PostgreSQL/Testcontainers가 필요한 항목이며 PR CI에서
PostgreSQL migration과 transaction 경계를 최종 검증한다.
