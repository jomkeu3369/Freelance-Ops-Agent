# Scheduler Retry·Checkpoint Resume 실험

> 실험일: 2026-08-27
> 상태: Synthetic attempt-level prototype result
> 목적: 실패 후 전체 재시작이 만드는 service-demand 증폭과 checkpoint resume의 효용 검증

## 1. 연구 질문

1. 독립적인 Sub-Agent 실행 실패에서 전체 restart와 checkpoint resume 중 어느 방식이 SLO와 비용에 유리한가?
2. Exponential backoff와 jitter는 항상 적용해야 하는가, provider outage에서만 적용해야 하는가?
3. Global retry budget은 overload를 완화하면서 사용자 완료율을 보존하는가?
4. Checkpoint 저장 overhead가 1초일 때 적절한 checkpoint 간격은 얼마인가?
5. 60초 provider outage 이후 retry storm을 어떻게 줄여야 하는가?

## 2. 현재 코드와 실험의 경계

현재 `PostgresCheckpointJournal`은 run lifecycle과 LangGraph 실행 state를 저장하지만, 실패 직전까지
Sub-Agent가 수행한 세부 service progress를 몇 초나 재사용하는지는 측정하지 않는다. 이번 코드는
운영 runtime을 수정하지 않고 `experiments/runtime_scheduler`의 event simulator에서 다음을
모델링한다.

```text
Original task arrival
  → Predicted-SJF + Priority + bounded aging dispatch
  → attempt 실행
      ├─ 완료
      ├─ 독립 failure
      └─ correlated provider outage
  → Restart 또는 마지막 durable checkpoint부터 Resume
  → Immediate 또는 exponential backoff + deterministic jitter
  → per-task max attempts와 optional global retry budget
```

Checkpoint 사이에서 실행한 progress는 실패 시 손실되며 checkpoint boundary 이전 progress만 durable로
재사용한다. Checkpoint write도 Worker를 점유하는 overhead로 계산한다.

## 3. 기준 설정

```yaml
paired_workload_seeds: 15
offered_load_ratio_without_retry: 0.81
workers: 6
independent_attempt_failure_probability: 0.20
max_attempts: 4
checkpoint_interval_seconds: 30
checkpoint_overhead_seconds: 1
base_backoff_seconds: 30
maximum_backoff_seconds: 180
jitter_ratio: 0.50
global_retry_budget_ratio: 0.15
completion_slo_seconds: 300
worker_hour_cost: 0.12 USD
```

Worker 단가는 정책 간 상대 비교용 가정이며 실제 provider 청구액이 아니다. 모든 민감도 실험은 동일
Task stream과 Runtime Predictor 출력을 재사용한다.

## 4. 독립 실패 전략 비교

| Strategy | Eventually completed | SLO goodput | P95 | Demand amplification | Wasted useful work | Worker cost |
|---|---:|---:|---:|---:|---:|---:|
| Restart immediate | 99.8% | 94.8% | 258.4 sec | 1.129× | 1028.1 sec | $0.336 |
| Restart + backoff | 99.8% | 94.0% | 291.7 sec | 1.129× | 1028.1 sec | $0.346 |
| Restart + backoff + budget | 92.2% | 89.3% | 232.4 sec | 1.025× | 930.5 sec | $0.326 |
| Checkpoint immediate | **99.8%** | **96.0%** | 238.2 sec | 1.104× | 683.9 sec | $0.329 |
| Checkpoint + backoff | 99.8% | 95.1% | 265.5 sec | 1.104× | 683.9 sec | $0.341 |
| Checkpoint + backoff + budget | 92.2% | 89.6% | **222.4 sec** | **1.022×** | **628.0 sec** | **$0.326** |


`Checkpoint immediate`만 99% eventual completion과 95% SLO goodput gate를 모두 통과했다. Restart
immediate 대비 다음 변화가 있었다.

- SLO goodput: 94.8% → 96.0%, 1.2%p 개선
- P95: 258.4초 → 238.2초, 7.8% 감소
- Wasted useful work: 1028.1초 → 683.9초, 33.5% 감소
- Demand amplification: 1.129× → 1.104×
- Worker cost: $0.336 → $0.329, 약 2.1% 감소

독립 실패에 backoff를 항상 적용하면 service demand는 변하지 않고 P95와 비용만 증가했다. 실패한
provider가 즉시 회복 가능한 상태라면 resume을 지연할 근거가 없다.

## 5. Failure rate 민감도

| Failure probability | Restart goodput | Restart demand | Checkpoint goodput | Checkpoint demand |
|---:|---:|---:|---:|---:|
| 0% | 99.8% | 1.000× | 99.8% | 1.017× |
| 10% | 98.5% | 1.054× | 98.6% | 1.054× |
| 20% | 94.8% | 1.129× | **96.0%** | 1.104× |
| 30% | 88.8% | 1.211× | 91.2% | 1.159× |
| 40% | 80.4% | 1.313× | 84.4% | 1.224× |


Failure 0%에서는 checkpoint write 때문에 demand가 1.7% 증가한다. 약 10%에서는 restart와 checkpoint
demand가 같아지고, 20%부터 checkpoint의 이점이 분명해진다. 따라서 모든 짧은 Task에 checkpoint를
강제하지 않고 다음 조건을 초기 후보로 둔다.

```text
predicted runtime >= checkpoint interval
AND (observed failure risk >= 10% OR task side-effect/recovery cost가 큼)
```

Budget 전략의 P95가 failure 30–40%에서 낮아지는 것은 빠른 복구가 아니라 많은 Task를 영구 실패로
종료했기 때문이다. Failed rate와 함께 보지 않은 P95는 잘못된 정책 선택을 유발한다.

## 6. Checkpoint 간격

| Interval | SLO goodput | Demand amplification | Checkpoint overhead | Worker cost |
|---:|---:|---:|---:|---:|
| 10 sec | 95.8% | 1.123× | 642.9 sec | $0.331 |
| 20 sec | **96.3%** | **1.103×** | 255.4 sec | $0.330 |
| 30 sec | 96.0% | 1.104× | **133.8 sec** | **$0.329** |
| 60 sec | 95.4% | 1.119× | 33.5 sec | $0.331 |
| 120 sec | 95.4% | 1.124× | 4.9 sec | $0.333 |


20초는 goodput과 demand가 가장 좋고 30초는 거의 같은 SLO에서 checkpoint overhead와 worker 비용이
더 낮다. Hard gate 통과 후 비용을 최소화하는 현재 선택 규칙에 따라 기본값은 30초로 둔다. 작업
종류별 failure hazard와 checkpoint write latency가 측정되면 고정값 대신 Task class별 interval로
재보정해야 한다.

## 7. Correlated provider outage와 retry storm

추가 설정:

```yaml
independent_failure_probability: 0.05
provider_outage_at_seconds: 500
provider_outage_duration_seconds: 60
backoff_base_seconds: 60
jitter_ratio: 0.50
retry_burst_window_seconds: 10
```

| Strategy | Retry burst / 10 sec | Peak queue | Recovery | SLO goodput |
|---|---:|---:|---:|---:|
| Restart immediate | 5.9 | 31.2 | 42.6 sec | 97.2% |
| Restart + backoff | 4.0 | 28.0 | 56.3 sec | 97.1% |
| Checkpoint immediate | 6.0 | 31.7 | **39.9 sec** | **97.3%** |
| Checkpoint + backoff | **3.9** | **28.4** | 46.5 sec | 97.0% |


Checkpoint + backoff는 checkpoint immediate 대비 10초 retry burst를 약 35%, peak queue를 약 10.4%
줄였다. 대신 recovery가 39.9초에서 46.5초로 16.5% 늘고 goodput이 0.3%p 감소했다. Backoff는
일반적인 latency 최적화가 아니라 provider recovery를 보호하는 부하 완충 장치다.

## 8. Retry budget 판단

15% global retry budget은 demand amplification을 1.022×까지 낮췄지만 eventual completion도 92.2%로
낮췄다. 이는 효율 개선이라기보다 일부 작업을 포기한 결과다.

따라서 global retry budget은 기본 retry 정책이 아니라 다음 상황에서만 Admission Controller와 함께
활성화한다.

```text
predicted load including retry > capacity
OR provider circuit breaker open
OR retry rate exceeds error-budget threshold
```

Retry budget 소진은 조용한 실패가 아니라 명시적인 `RETRY_BUDGET_EXHAUSTED` terminal reason으로
기록하고, high-priority Task에는 reserved retry tokens를 별도로 제공해야 한다.

## 9. 권장 상태 기반 정책

```text
Task 실행 실패
  → durable checkpoint 존재?
      ├─ Yes: 마지막 checkpoint부터 resume
      └─ No: restart
  → Failure classifier
      ├─ Independent/transient
      │    → 즉시 retry
      └─ Provider outage / correlated 429·5xx
           → circuit breaker
           → provider Retry-After 또는 outage recovery까지 대기
           → exponential backoff + jitter
  → Predicted retry demand가 capacity 초과?
      ├─ No: per-task max attempts 안에서 실행
      └─ Yes: priority-aware retry budget + admission/degrade
```

초기 설정 후보:

```yaml
checkpoint_interval_seconds: 30
checkpoint_overhead_target_seconds: 1
checkpoint_enable_failure_risk: 0.10
max_attempts: 4
backoff_only_when_circuit_open: true
retry_budget_only_during_overload: true
retry_budget_exhaustion_reason: RETRY_BUDGET_EXHAUSTED
```

## 10. 한계

- Failure probability는 attempt당 독립 확률이며 runtime 길이에 따른 hazard 변화는 아직 없다.
- Checkpoint는 일정한 service progress 간격으로 생성된다고 단순화했다.
- 실제 LLM request, Tool side effect와 idempotency 비용을 포함하지 않았다.
- Provider outage는 전체 Worker pool에 동시에 적용되는 단일 사건이다.
- Backoff는 provider가 제공하는 실제 `Retry-After`가 아니라 설정값이다.
- Global retry budget은 workspace·priority별 reserved share가 없다.
- Synthetic workload이므로 운영 도입 전 실제 execution history shadow replay가 필요하다.

## 11. 다음 단계

1. 실제 execution history를 `queued_at`, `started_at`, `completed_at`, retry와 checkpoint event로 변환
2. 동일 로그에서 현행 FIFO와 후보 정책의 shadow replay
3. Runtime 길이에 따른 failure hazard와 provider별 error correlation 추정
4. Priority·workspace별 reserved retry tokens 검증
5. 실제 checkpoint serialization latency와 artifact reuse율 측정

## 12. 재현 방법

```powershell
cd agent
uv run python -m experiments.runtime_scheduler.plot_retry_checkpoint_simulation
uv run pytest experiments/runtime_scheduler/test_retry_checkpoint_simulation.py
```

구현 파일:

- `experiments/runtime_scheduler/retry_checkpoint_simulation.py`
- `experiments/runtime_scheduler/plot_retry_checkpoint_simulation.py`
- `experiments/runtime_scheduler/test_retry_checkpoint_simulation.py`
