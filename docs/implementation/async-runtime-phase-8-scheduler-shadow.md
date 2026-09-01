# Async Runtime Phase 8 · 영속 FIFO Queue와 계층형 Scheduler Shadow

## 1. 구현 경계

Phase 8은 실제 실행 순서를 바꾸지 않는다. 운영 Dispatcher는 `fifo-v1`을 유지하고, 같은 영속
대기열 snapshot에 대해 `scheduler-shadow-v1` 후보의 admission·순위·rescue lane을 함께 기록한다.
실제 TaskAttempt 로그 7일·1,000건과 승격 gate를 통과하기 전에는 shadow의 defer, reject, scale 요청을
실행하지 않는다.

```text
이미 QUEUED로 영속화된 TaskAttempt
  → resource pool별 Scheduler entry 기록
  → actual: available_at + enqueue FIFO
  → shadow: 계층형 admission + SLO-aware PSJF + bounded aging
  → actual/shadow rank와 판단 snapshot 영속화
  → FIFO claim lease
  → Worker dispatch 확인
```

## 2. 영속 Queue

`agent_scheduler_entry`는 attempt당 한 행을 사용한다.

- `READY`와 `RETRY`를 구분한다.
- `available_at` 전에는 claim할 수 없으므로 retry backoff가 즉시 재실행되지 않는다.
- `PENDING → CLAIMED → DISPATCHED` 상태와 1~300초 lease를 사용한다.
- 만료된 claim은 같은 행을 다시 `PENDING`으로 돌려 중복 Task를 만들지 않는다.
- `resource_pool`을 모든 조회와 claim 조건에 포함해 provider/model pool이 섞이지 않는다.
- 실제 FIFO rank와 shadow rank·score·lane을 같은 snapshot에 기록한다.

`agent_worker_capacity_event`는 resource pool별 Worker 수와 관측 시각을 append-only로 기록한다.
미래 capacity를 현재 판단에 사용하지 않는다.

## 3. Shadow Admission

확정된 synthetic 후보의 기본값을 사용한다.

```yaml
global_drain_limit_seconds: 120
priority_wait_slo_seconds: 60
workspace_burst_work_seconds: 240
maximum_defer_seconds: 600
emergency_drain_seconds: 300
scale_factor: 2.0
```

계산값은 global predicted drain, workspace predicted drain, priority 4~5 best-case drain이다. 과부하가
감지되면 projected 2× Worker로 emergency drain을 만족하는지 기록한다. 이 결과는
`ADMIT / DEFER / REJECT`와 `SCALE_REQUIRED` 사유를 만들지만 실제 상태를 변경하지 않는다.

## 4. Shadow Ranking

실제 순서는 eligible entry의 `available_at, enqueued_at, attempt_id` FIFO다. Shadow는 다음 순서를 쓴다.

1. priority 4~5가 45초 이상 기다리면 high-priority rescue
2. 120초 이상 기다린 작업은 네 번째 dispatch마다 bounded-aging rescue
3. 나머지는 아래 predicted score 오름차순

```text
score = predicted_runtime_seconds
        / (1 + 0.25 × (priority - 1) + 0.02 × wait_seconds)
```

실제 runtime, 최종 성공 여부, incident label은 decision-time 입력에 포함하지 않는다.

## 5. 안전성

- Queue는 이미 durable `QUEUED`인 Task와 Attempt만 관측한다.
- task, attempt, workspace, revision, prediction과 priority snapshot 불일치를 fail closed한다.
- 중복 observation은 같은 입력일 때만 멱등 성공한다.
- claim 확인은 attempt, claim ID와 worker identity가 모두 일치해야 한다.
- Shadow reject와 scale은 권한·비용 변경을 일으키지 않는다.
- 보조 provider 전환은 사전 승인된 실행 profile이 생길 때까지 비활성 상태다.

## 6. 승격 Gate

다음 조건 전에는 실제 admission 또는 재정렬로 승격하지 않는다.

```yaml
minimum_attempts: 1000
minimum_observation_days: 7
minimum_load_bands: 3
required_field_missing_rate: 0
prediction_coverage: ">= 0.95"
predictor_version_coverage: 1.0
submitted_completion_goodput: ">= 0.95"
priority_wait_slo_goodput: ">= 0.95"
worst_workspace_completion_goodput: ">= 0.90"
workspace_acceptance_fairness: ">= 0.90"
maximum_wait_seconds: "<= 300"
```

## 7. 검증

- 순수 scheduler에서 FIFO와 shadow PSJF 순위 분리를 검증했다.
- high-priority rescue와 retry `available_at` 경계를 검증했다.
- 과부하 scale signal과 저우선순위 reject shadow 판단을 검증했다.
- ORM schema, runtime required table과 PostgreSQL observation/claim 경로 테스트를 추가했다.
- 로컬 PostgreSQL URL이 없을 때 통합 테스트는 skip하며 GitHub CI의 pgvector PostgreSQL에서 실행한다.
