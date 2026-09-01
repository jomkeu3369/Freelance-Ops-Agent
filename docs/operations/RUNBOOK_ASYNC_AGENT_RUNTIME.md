# Async Agent Runtime 장애 대응 Runbook

## 1. 적용 범위

이 문서는 영속 TaskAttempt, checkpoint, retry token bucket, provider circuit, FIFO queue, Scheduler
shadow와 runtime release registry 장애를 다룬다. Spring 업무 데이터는 Spring이, `agent_runtime` schema는
Agent가 소유한다. 장애 중 Python에서 `app` schema를 직접 수정하지 않는다.

## 2. 최초 확인

1. Spring readiness와 Agent health를 각각 확인한다.
2. 한 `run_id / task_id / attempt_id / revision`을 선택해 이벤트와 상태를 대조한다.
3. runtime operational snapshot에서 다음을 확인한다.

```text
queue_depth
retry_queue_depth
oldest_ready_age_seconds
active_claim_count
expired_lease_count
shadow_rank_disagreement_count
open_provider_circuit_count
approved_release_count
```

4. prompt, credential, resume token 원문과 고객 파일 내용을 로그·이슈에 복사하지 않는다.
5. 실제 FIFO와 shadow 판단을 구분한다. Shadow의 reject, defer 또는 scale 신호는 운영 상태가 아니다.

## 3. 증상별 조치

| 증상 | 확인 | 즉시 조치 |
|---|---|---|
| oldest ready age 120초 초과 | Worker health, capacity event freshness, claim 수 | 신규 batch 접수를 줄이고 FIFO 유지 |
| oldest ready age 300초 초과 | provider circuit, DB lock, Worker crash | Scheduler/모델 승격 중단, incident 선언 |
| 만료 lease 반복 | Worker heartbeat와 종료 로그 | lease 회수 허용, 동일 attempt 중복 생성 금지 |
| retry queue 급증 | failure classification, workspace/global bucket | bucket을 임의 확대하지 말고 correlated circuit 확인 |
| provider circuit OPEN | provider 429/5xx, 영향 workspace 수 | 자동 보조 provider 전환 금지, checkpoint 유지 |
| shadow disagreement 증가 | priority, prediction drift, resource pool | actual FIFO 유지, release gate 재평가 |
| release evidence 불일치 | artifact SHA, dataset fingerprint, report | release 사용 중지, 새 version으로만 재등록 |

## 4. 안전한 복구 순서

```text
신규 저우선순위 접수 제한
  → Worker와 PostgreSQL 상태 확인
  → 만료 claim만 동일 queue row에서 회수
  → checkpoint와 side-effect idempotency key 확인
  → circuit probe 결과 확인
  → FIFO로 제한된 smoke attempt 1건
  → 15분 안정화 관측
```

Task, Attempt 또는 Scheduler entry를 복제해 복구하지 않는다. Retry는 기존 task identity와 새
attempt number를 사용하고 `retry_ready_at` 이전에는 release하지 않는다. write side effect는 기존
idempotency key를 재사용한다.

## 5. Rollback

- Scheduler 정책: actual `fifo-v1`은 그대로이므로 shadow collector만 중지한다.
- Runtime Predictor: 직전 승인 version으로 되돌리고 새 prediction은 version을 명시한다.
- Agent 배포: immutable image marker의 직전 Agent tag만 rollback한다.
- Migration: 서비스가 이전 schema와 호환되는지 확인한 뒤 Alembic 한 revision만 downgrade한다.
- Spring과 Agent를 동시에 rollback하지 않는다. contract 호환성 실패가 확인된 경우에만 각 서비스
  marker를 독립적으로 되돌린다.

## 6. 금지 사항

- `git reset --hard`, volume 삭제, DB schema drop을 장애 대응 첫 조치로 사용하지 않는다.
- token bucket과 circuit breaker를 동시에 해제하지 않는다.
- 실제 데이터 gate 미통과 Scheduler를 active dispatch로 전환하지 않는다.
- 자기 승인 감사 기록을 실제 독립 reviewer 승인으로 표현하지 않는다.
- Redis, Kafka 또는 자동 provider fallback을 임시 우회로 추가하지 않는다.

## 7. 복구 완료 조건

- queue oldest age가 120초 아래로 내려가고 15분간 증가하지 않는다.
- expired lease가 0이며 동일 side effect 중복이 없다.
- provider failure와 capacity rejection이 SLO 아래다.
- checkpoint resume 1건과 cancel 1건이 정확한 revision에서 종료된다.
- runtime release와 artifact/dataset hash가 일치한다.
- 원인, 영향 workspace, 탐지, 완화, rollback, 재발 방지와 검증 결과를 기록한다.
