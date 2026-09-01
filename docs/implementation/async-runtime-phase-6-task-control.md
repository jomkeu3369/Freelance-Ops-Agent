# Async Runtime 구현 Phase 6 Task Control Plane

> 기준일: 2026-09-01
> 상태: 구현 및 로컬 검증 완료, PostgreSQL CI 검증 대기

## 1. 범위와 권위

사용자는 Spring 공개 API를 통해 Task 목록과 단일 Task 상태를 조회하고 soft update, hard redirect,
cancel 명령을 보낸다. 공개 상태의 권위는 `app.agent_task`이며 모델 응답이나 메모리 상태로 진행률을
추측하지 않는다. 응답에는 실제 `status`, `phase`, `activity`, `lastHeartbeatAt`, revision과 현재 attempt
번호만 포함한다.

Spring 코드는 기존 `agentrun`과 같은 `controller`, `dto/request`, `dto/response`, `entity`, `repository`,
`service`, `client` 구조를 사용한다.

## 2. 공개 API

```text
GET  /api/v2/workspaces/{workspaceId}/agent-runs/{runId}/tasks
GET  /api/v2/workspaces/{workspaceId}/agent-runs/{runId}/tasks/{taskId}
POST /api/v2/workspaces/{workspaceId}/agent-runs/{runId}/tasks/{taskId}/instructions
POST /api/v2/workspaces/{workspaceId}/agent-runs/{runId}/tasks/{taskId}/redirect
POST /api/v2/workspaces/{workspaceId}/agent-runs/{runId}/tasks/{taskId}/cancel
```

조회에는 `agent.run`, 지시와 redirect에는 `agent.respond`, 취소에는 `agent.cancel`이 필요하다. 모든
조회와 명령은 인증 사용자의 현재 workspace membership과 run/task scope를 다시 검사한다.

## 3. 명령과 상태 전이

- soft update는 immutable command를 저장한 뒤 Spring Task를 `UPDATE_PENDING`으로 표시한다.
- Agent는 soft update를 durable inbox에 `PENDING`으로 저장하고 Task와 Attempt가 모두
  `CHECKPOINTED`일 때만 적용한다.
- 적용 transaction은 Task/Attempt를 `RUNNING`으로 전환하고 `attempt.update_applied` Outbox event를
  함께 생성한다. event에는 instruction 원문 대신 command ID만 기록한다.
- hard redirect는 현재 attempt를 `SUPERSEDED`로 fencing하고 같은 task ID의 revision을 증가시킨다.
  Spring의 immutable execution profile과 Agent의 execution snapshot은 새 revision으로 복제한다.
- cancel은 Spring을 `CANCELLING`으로 만든다. Agent가 현재 revision과 active attempt를
  `CANCELLED`로 fencing한 `APPLIED` 응답을 보낸 뒤 Spring도 row lock으로 `CANCELLED`를 확정한다.
- 이전 revision의 완료나 heartbeat는 현재 projection에 병합되지 않는다.

## 4. 전달 신뢰성과 보안

Spring command Outbox는 같은 idempotency key의 정확한 재전송에 기존 command ID를 반환하며 상태를
두 번 변경하지 않는다. Dispatcher는 전달 직전에 사용자의 현재 membership과 필요한 permission을
다시 확인하고 짧은 수명의 run-scoped delegation token으로 Agent API를 호출한다.

Agent의 `agent_task_command_receipt`는 command ID, payload hash, authorization/budget revision과 적용
상태를 저장한다. 네트워크 ACK 유실로 같은 명령이 다시 전달되어도 같은 결과를 반환하고, 같은 ID의
다른 payload는 거부한다. 권한 또는 예산 확장은 일반 지시로 적용하지 않으며 별도 승인 명령 범위로
남긴다.

## 5. 검증 기준

- 실제 PostgreSQL에서 soft update의 checkpoint 적용과 event Outbox 원자성
- hard redirect의 새 revision 생성, 이전 attempt supersede와 중복 적용 방지
- cancel의 Agent/Spring 양쪽 현재 revision fencing과 late result 거부
- workspace/run/task scope와 현재 permission 재검증
- command delivery lease, 제한된 retry와 정확한 ACK identity 검증
- 전체 Backend/Agent 회귀, Ruff, strict mypy와 Alembic upgrade/downgrade

다음 Phase에서는 checkpoint payload, retry token bucket, 다중 신호 장애 분류와 provider circuit
breaker를 구현한다.
