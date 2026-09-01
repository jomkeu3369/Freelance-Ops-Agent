# Workspace Retry Token Bucket 실험 보고서

작성일: 2026-08-27
상태: Synthetic counterfactual 검증 완료, TaskAttempt shadow telemetry 검증 전

## 1. 목적

기존 Failure-aware Scheduler는 전체 제출 task 수의 20%를 global retry budget으로 사용했다. 이
방식은 총 retry 수는 제한하지만 먼저 실패한 noisy workspace가 전역 예산을 선점해 뒤에 실패한
정상 workspace의 복구 기회를 빼앗을 수 있다.

이번 실험은 다음 질문을 검증한다.

1. Workspace별 token bucket이 retry storm을 tenant 단위로 격리하는가?
2. Workspace bucket만 사용할 때 여러 workspace에서 동시에 retry가 증가하는 위험을 막을 수 있는가?
3. Global bucket과 workspace bucket을 결합하면 local isolation과 aggregate safety를 함께 얻는가?
4. Priority task에 retry token 차입을 허용할 필요가 있는가?

## 2. 비교 정책

| 정책 | Workspace 격리 | 전체 retry 제한 | Priority 차입 |
|---|---|---|---|
| Global budget | 없음 | 제출 task의 20% lifetime cap | 없음 |
| Workspace token bucket | 있음 | 없음 | 없음 |
| Global + workspace bucket | 있음 | global token bucket | 없음 |
| Hierarchical + priority borrow | 있음 | global token bucket | 최대 2 token |

선택 후보의 기본 파라미터는 다음과 같다.

```yaml
workspace_bucket:
  capacity: 12
  refill_tokens_per_second: 0.10
global_bucket:
  capacity: 16
  refill_tokens_per_second: 0.10
priority_borrow_limit: 0
max_attempts: 4
checkpoint_interval_seconds: 30
base_backoff_seconds: 15
maximum_backoff_seconds: 90
```

Token은 attempt가 실패해 retry를 예약하는 순간 소비한다. 시간이 지나면 정해진 rate로 refill되며
capacity를 넘겨 축적하지 않는다. 계층형 정책은 workspace와 global bucket 양쪽에 token이 있을 때만
일반 retry를 허용한다.

## 3. 실험 설계

- Noisy neighbor, sleep/wake burst, elephant and mice의 3개 adversarial scenario
- 5개 고정 seed
- Scale 성공과 실패를 동일 workload로 paired 실행
- Scale 성공 확률 90%로 counterfactual 결과 결합
- Healthy workspace attempt failure 5%
- 지정 noisy workspace attempt failure 35%
- 모든 정책에서 checkpoint와 exponential backoff 사용
- 제출된 task가 reject 또는 late completion이면 분모에서 제거하지 않음

Noisy workspace는 scenario별로 트래픽 또는 service demand를 지배하는 workspace로 지정했다.

```text
noisy_neighbor      -> workspace-noisy
sleep_wake_burst    -> workspace-continuous-a
elephant_and_mice   -> workspace-elephant
```

## 4. 격리 Stress Gate

이번 gate는 정상 운영 SLO가 아니라 35% noisy attempt failure를 견디는 격리 시험용 하한이다.
정상 운영에서는 기존 completion goodput 95% 목표를 유지한다.

```yaml
submitted_completion_goodput: ">= 88% stress floor"
healthy_workspace_goodput: ">= 95%"
noisy_workspace_goodput: ">= 65%"
priority_wait_goodput: ">= 95%"
workspace_completion_fairness: ">= 0.90"
demand_amplification: "<= 1.25"
healthy_budget_exhaustion: "<= 2%"
expected_paired_gate_pass: ">= 90%"
```

## 5. 결과

| 정책 | 전체 goodput | Healthy goodput | Noisy goodput | Demand amp. | Healthy exhaustion | 비용/run | Gate pass |
|---|---:|---:|---:|---:|---:|---:|---:|
| Global budget | 91.6% | 98.1% | 83.4% | 1.060 | 1.9% | $0.128 | 43.3% |
| Workspace token bucket | 95.6% | 100.0% | 88.6% | 1.122 | 0.0% | $0.140 | 96.7% |
| Global + workspace bucket | **95.6%** | **99.9%** | **88.7%** | **1.122** | **0.1%** | **$0.140** | **96.7%** |
| Hierarchical + priority borrow | 95.7% | 99.9% | 88.8% | 1.122 | 0.1% | $0.140 | 96.7% |

`Global + workspace bucket`을 선택한다. Workspace-only와 정상 단일-noisy 조건의 성능은 거의 같지만,
global bucket이 여러 workspace의 retry가 함께 증가할 때 총 증폭을 제한한다. Priority borrow는 priority
goodput을 추가로 개선하지 않았고 정책 복잡도만 늘리므로 기본값에서 제외한다.

Global-only 대비 선택 정책은 run당 예상 Worker 비용이 약 9.4% 증가했지만 전체 goodput이 4.0%p,
healthy goodput이 1.8%p 증가했고 healthy budget exhaustion은 1.9%에서 0.1%로 감소했다. Global-only의
낮은 비용은 더 많은 task를 실패시켜 실행 시간이 짧아진 결과이므로 효율 개선으로 해석하면 안 된다.

## 6. Scenario별 결과

선택 정책의 healthy goodput은 noisy neighbor 100.0%, sleep/wake burst 99.8%, elephant and mice
100.0%다. Noisy workspace goodput은 각각 85.3%, 96.8%, 83.8%였다. Scenario별 expected gate
pass는 100%, 100%, 90%다.

Elephant and mice는 scale 실패 시 긴 elephant task를 completion SLO 안에 복구하기 가장 어려운
조건이다. 이 결과는 retry bucket뿐 아니라 scale fallback이 계속 필요함을 보여준다.

## 7. 민감도와 운영 경계

### Workspace capacity

| Capacity | Healthy goodput | Noisy goodput | Gate pass |
|---:|---:|---:|---:|
| 4 | 100.0% | 84.3% | 76.7% |
| 8 | 100.0% | 86.9% | 90.0% |
| 12 | 99.9% | 88.7% | 96.7% |
| 16 | 99.8% | 90.0% | 96.7% |
| 24 | 99.8% | 90.0% | 96.7% |

Capacity 8은 gate에 여유가 없고 16 이상은 통과율이 개선되지 않았다. 따라서 12를 초기 shadow
후보로 사용한다.

### Workspace refill

| Refill token/s | Noisy goodput | Gate pass |
|---:|---:|---:|
| 0.025 | 78.9% | 36.7% |
| 0.05 | 83.1% | 83.3% |
| 0.10 | 88.7% | 96.7% |
| 0.20 | 90.0% | 96.7% |
| 0.40 | 90.0% | 96.7% |

0.10 token/s 아래에서는 복구가 지나치게 제한되고 0.20 이상은 추가 gate 이득이 없다. 0.10 token/s,
즉 평균 10초당 1개 retry를 운영 후보로 둔다.

### Distributed retry pressure

| Healthy failure | Workspace-only amp. | Hierarchical amp. | Hierarchical healthy goodput | Gate pass |
|---:|---:|---:|---:|---:|
| 5% | 1.122 | 1.122 | 99.9% | 96.7% |
| 10% | 1.135 | 1.132 | 99.8% | 96.7% |
| 15% | 1.148 | 1.135 | 99.2% | 84.7% |
| 20% | 1.166 | 1.127 | 97.1% | 53.3% |
| 30% | 1.204 | 1.126 | 90.8% | 13.3% |

Global bucket은 failure가 확산될수록 demand amplification을 약 1.13에서 제한하지만 completion을
만들어 내지는 못한다. Healthy workspace failure가 15%에 도달하면 gate pass가 90% 아래로 내려간다.
따라서 이 지점은 bucket을 늘릴 조건이 아니라 multi-signal classifier가 correlated failure로 분류하고
circuit breaker, provider probe와 failover로 전환할 조건이다.

## 8. Plot

### 정책 비교


### Scenario별 Plot 표


### Capacity·Refill·분산 장애 민감도


## 9. Scheduler 적용 계약

```text
TaskAttempt fails
  -> Failure Classifier
     -> independent/local
        -> consume(workspace_retry_bucket)
        -> consume(global_retry_bucket)
        -> checkpoint resume with jittered backoff
     -> correlated or distributed failure >= 15%
        -> do not increase retry allowance
        -> circuit latch
        -> bounded global retry
        -> provider probe / secondary failover
```

Token bucket은 Scheduler의 정렬 정책과 분리한다. Ready Queue는 신규 task, Retry Queue는 재시도 task를
보관하며 retry admission 시에만 bucket을 소비한다. Workspace ID, priority, failure classification과
token decision reason은 TaskAttempt telemetry에 함께 저장해야 한다.

권장 reason code:

```text
RETRY_ALLOWED
WORKSPACE_BUCKET_EMPTY
GLOBAL_BUCKET_EMPTY
MAX_ATTEMPTS_REACHED
CORRELATED_FAILURE_CIRCUIT_OPEN
PRIORITY_BORROW_ALLOWED
```

## 10. 현재 한계

- 실제 TaskAttempt 로그가 아닌 synthetic failure다.
- Workspace별 failure가 독립 Bernoulli 분포이며 실제 tool/provider 상관 구조를 완전히 재현하지 않는다.
- Bucket 파라미터는 task 수 기반 token이며 runtime·cost 가중 token은 아직 비교하지 않았다.
- 동일 workspace 내부의 user별 격리와 plan별 서비스 등급은 포함하지 않았다.
- Retry side effect의 idempotency와 checkpoint artifact durability는 simulator 밖의 계약이다.
- Global token refill은 단일 process 상태로 모델링했으며 분산 원자성 구현은 검증하지 않았다.

## 11. 다음 검증

1. 실제 TaskAttempt에 retry decision snapshot과 reason code 추가
2. Shadow replay에서 workspace별 token 소비와 refill 재현
3. Runtime-weighted token과 count-based token 비교
4. Redis 또는 PostgreSQL 원자적 bucket 구현 없이 먼저 single-writer Dispatcher에서 검증
5. Classifier의 correlated 판정과 circuit latch를 end-to-end로 연결
6. 실제 provider billing으로 cost per successful outcome 재계산

## 12. 재현 방법

```powershell
cd agent
$env:PYTHONPATH = "$PWD\.venv\Lib\site-packages"
.\.venv-codex\Scripts\python.exe -m pytest experiments\runtime_scheduler\test_workspace_retry_budget_simulation.py -q
.\.venv-codex\Scripts\python.exe -m experiments.runtime_scheduler.plot_workspace_retry_budget
```

관련 구현:

- `experiments/runtime_scheduler/retry_checkpoint_simulation.py`
- `experiments/runtime_scheduler/workspace_retry_budget_simulation.py`
- `experiments/runtime_scheduler/plot_workspace_retry_budget.py`
- `experiments/runtime_scheduler/test_workspace_retry_budget_simulation.py`

검증 결과:

```text
pytest experiments/runtime_scheduler -q: 124 passed
ruff check experiments/runtime_scheduler: All checks passed
```
