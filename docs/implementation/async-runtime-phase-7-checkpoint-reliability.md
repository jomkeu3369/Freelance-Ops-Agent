# Async Runtime 구현 Phase 7 Checkpoint·Retry Reliability

> 기준일: 2026-09-01
> 상태: 구현 및 로컬 단위 검증 완료, PostgreSQL CI 검증 대기

## 1. 범위

Phase 7은 실행 순서를 선택하는 Scheduler가 아니라 실패 이후의 안전한 복구 결정을 구현한다. Agent가
checkpoint와 retry 정책의 권위 있는 상태를 `agent_runtime` PostgreSQL에 저장하고, Spring은 사용자에게
공개할 최소 projection만 `app` schema에 보존한다. 실제 Ready/Retry Queue 정렬은 Phase 8 범위다.

## 2. Checkpoint 계약

checkpoint에는 다음 값만 저장한다.

```text
checkpoint_id
checkpoint_artifact_reference
resume_token_hash
checkpoint_restored_seconds
completed_steps
side_effect_idempotency_keys
```

원문 resume token은 발급 시 한 번만 반환하며 DB, event와 Spring projection에 기록하지 않는다. SHA-256
hash만 Agent attempt row에 보존하고 constant-time 비교로 검증한다. `prompt`, `chain_of_thought`, secret,
delegation token과 원문 resume token은 모든 깊이의 event data에서 거부한다.

RUNNING Task와 Attempt만 CHECKPOINTED로 전환할 수 있다. attempt 상태, checkpoint 메타데이터와
`attempt.checkpointed` Outbox event는 같은 PostgreSQL transaction에서 기록한다. 같은 checkpoint ID와
token hash의 재호출은 기존 공개 메타데이터를 반환하고 다른 checkpoint로 덮어쓰지 않는다.

## 3. 다중 신호 실패 분류

운영 후보 `weighted-multi-signal-v1`은 다음 구조화 신호만 사용한다.

- provider error: +2
- rate limit: +1
- 영향 workspace 3개 이상: +2
- 영향 worker 비율 30% 이상: +1
- provider status degraded: +2
- local worker error 반증: -2
- Tool health confirmed 반증: -1

점수 4 이상만 `CORRELATED_PROVIDER`로 분류한다. 결정적 validation·권한·예산 오류는 별도
`DETERMINISTIC` 분류로 retry하지 않는다. 최종 incident label은 결정 시점 snapshot에 포함하지 않는다.

## 4. 계층형 Retry Token Bucket

독립 일시 실패에만 workspace bucket과 global bucket에서 각각 토큰 1개를 같은 transaction에서
소비한다. 초기 shadow 후보는 실험에서 검증한 다음 값이다.

```text
workspace: capacity 12, refill 0.10 token/s
global:    capacity 16, refill 0.10 token/s
priority borrow: disabled
```

한쪽 bucket이라도 비어 있으면 어느 bucket도 소비하지 않는다. 결정 snapshot에는 분류, confidence,
classifier/bucket policy version, 양쪽 token before/after와 retry ready time을 기록한다. Spring ingestion은
ALLOW에서 양쪽 토큰이 정확히 1 감소했는지, DENY에서 변하지 않았는지 다시 검증한다.

## 5. Provider Circuit

상관 provider 장애는 token을 늘려 retry하지 않고 provider/model별 circuit을 OPEN으로 latch한다. 기본
recovery probe 대기는 30초이며, probe가 성공해야 CLOSED로 돌아간다. 실패하면 다시 OPEN으로 전환한다.
상태는 `agent_provider_circuit`에 저장해 process 재시작으로 사라지지 않는다.

자동 secondary failover는 임의로 권한과 비용 계약을 확장할 수 있으므로 이번 단계에서 수행하지 않는다.
Phase 8 Dispatcher가 사전 승인된 secondary provider profile을 가진 Task에 한해서 circuit 상태를 읽고
대체 경로를 선택한다.

## 6. Event와 공개 Projection

```text
attempt.failed
  -> attempt.retry_decided
     -> ALLOW: Task RETRY_WAIT
     -> DENY:  Task FAILED
```

Spring은 checkpoint ID, artifact reference, 복구 작업량, 완료 step, side-effect idempotency key, 실패 분류,
retry decision/reason과 token snapshot을 투영한다. 사용자 Task 상태에는 `RETRY_WAIT` 또는 `FAILED`와
구조화 reason을 표시한다. 이전 revision이나 이전 attempt event는 감사 원본으로만 남고 현재 projection을
변경하지 않는다.

## 7. 검증 기준

- 독립·상관·결정적 실패 분류 경계
- workspace/global token의 원자적 소비와 refill
- circuit latch, bounded probe와 hysteresis
- checkpoint·event 원자성 및 원문 resume token 비저장
- retry 결정 재호출의 멱등성과 token 이중 소비 방지
- Spring token accounting 재검증과 current revision fencing
- Alembic/Flyway migration, 전체 Backend/Agent 회귀와 실제 PostgreSQL 통합

다음 Phase에서는 이 신뢰성 결정을 소비하는 durable Ready/Retry Queue, admission, PSJF+aging과 shadow
Scheduler를 구현한다.
