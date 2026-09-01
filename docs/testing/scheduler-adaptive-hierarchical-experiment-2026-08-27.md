# Adaptive Hierarchical Scheduler 실험

> 실험일: 2026-08-27
> 상태: Adversarial synthetic prototype result
> 현재 후보: `Hierarchical + scale`
> 승격 조건: scale failure·billing·prediction error와 실제 shadow replay 검증 전까지 prototype

## 1. 연구 배경

이전 multi-tenant 실험에서는 Global Predicted-SJF가 평균 효율은 가장 좋았지만 elephant burst의
priority wait SLO와 worst-workspace goodput을 보호하지 못했다. 항상-on Fair Queue와 정적 workspace
quota는 처리 순서를 공정하게 보이게 만들 수 있어도, 제출 Task를 늦추거나 거절해 실제 goodput을
낮췄다.

이번 실험은 Scheduler를 하나의 정렬 함수가 아니라 다음 계층으로 구성한다.

```text
Task arrival
  → Global predicted-drain 계산
  → Workspace soft quota 계산
  → Priority best-case feasibility 검사
  → 필요할 때만 scale 요청
  → ADMIT / DEFER / REJECT
  → SLO-aware PSJF + bounded aging
  → Worker Pool
```

## 2. Adaptive 정책

### Global guard

현재까지 수락한 predicted work에서 시간 경과 동안 Worker capacity를 차감한다.

```text
global_predicted_drain
=
remaining_predicted_work / current_workers
```

120초를 넘으면 overload로 보고 low priority를 보호 대상에서 제외하거나 normal priority를 defer한다.

### Workspace soft quota

workspace별 predicted backlog에 공정한 capacity share를 적용한다. 기본 burst allowance는 240
work-seconds다. 단, global drain이 정상 범위라면 quota를 강제하지 않고 Worker를 work-conserving하게
사용한다. 이 조건이 없으면 정상적인 sleep/wake workload까지 불필요하게 제한됐다.

### Priority feasibility

priority 4–5 backlog를 모든 현재 Worker에 할당해도 60초 안에 drain할 수 없는지 검사한다. 이는
예약 Worker 수가 아니라 best-case capacity lower bound다.

```text
priority_best_case_drain
=
priority_predicted_work / current_workers
```

best-case가 SLO를 넘으면 정렬 정책을 바꾸는 대신 capacity 부족으로 분류한다.

### Causal scale trigger

현재 시점까지 관측한 global drain이 120초를 넘거나 priority best-case drain이 60초를 넘을 때 한 번만
scale을 요청한다. 미래 arrival은 사용하지 않는다.

```yaml
base_workers: 6
scale_factor: 2.0
scale_delay_seconds: 30
global_drain_trigger_seconds: 120
priority_wait_slo_seconds: 60
emergency_drain_seconds: 300
```

Scale 성공 후 projected drain이 emergency limit 안이면 static quota를 빌릴 수 있게 해 legitimate
burst를 거절하지 않는다.

## 3. 비교 전략

| Strategy | Admission | Dispatcher | Scale |
|---|---|---|---|
| Accept all + Global PSJF | 모두 수락 | Global PSJF + Aging | 없음 |
| Global backlog guard | global drain 기준 | Global PSJF + Aging | 없음 |
| Workspace quota | workspace token/defer | Global PSJF + Aging | 없음 |
| Hierarchical static | soft quota + priority feasibility | SLO-aware PSJF | 없음 |
| Hierarchical + scale | soft quota + feasibility + borrowing | SLO-aware PSJF | 조건부 2× |

거절과 SLO를 넘긴 defer는 제출 Task 기준 실패로 계산한다. 수락된 Task만 보고 정책을 유리하게
평가하지 않는다.

## 4. Hard gate

각 strategy는 3 scenario × 5 paired seed의 모든 run에서 다음 조건을 통과해야 한다.

```yaml
submitted_completion_goodput: ">= 0.95"
priority_wait_slo_goodput: ">= 0.95"
worst_workspace_completion_goodput: ">= 0.90"
workspace_acceptance_fairness: ">= 0.90"
maximum_wait_seconds: "<= 300"
```

평균값이 좋아도 한 seed에서 gate를 위반하면 운영 후보로 선택하지 않는다. 여러 후보가 통과하면
SLO tasks per 1,000 worker-seconds가 높은 정책을 선택한다.

## 5. 전체 결과

| Strategy | Admitted | Completion goodput | Priority SLO | Worst workspace | P95 | Worker capacity | Efficiency | Scale runs | Gate pass |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Accept all + Global PSJF | 100.0% | 97.5% | 86.8% | 84.9% | 163.0 sec | 3,456 | 55.1 | 0.0% | 66.7% |
| Global backlog guard | 88.3% | 88.3% | 88.1% | 84.9% | 115.4 sec | 3,061 | 58.6 | 0.0% | 66.7% |
| Workspace quota | 90.3% | 90.3% | 73.6% | 65.7% | **110.8 sec** | 3,157 | **68.7** | 0.0% | 33.3% |
| Hierarchical static | 94.1% | 94.0% | 97.9% | 82.4% | 129.4 sec | **3,061** | 64.6 | 0.0% | 66.7% |
| Hierarchical + scale | **100.0%** | **100.0%** | **100.0%** | **100.0%** | 118.9 sec | 3,535 | 55.2 | 33.3% | **100.0%** |


`Hierarchical + scale`만 15개 paired run의 모든 hard gate를 통과했다. Accept-all과 비교하면 평균
Worker capacity는 3,456에서 3,535 worker-seconds로 약 2.3% 증가했지만, completion·priority·worst
workspace goodput이 모두 100%가 됐다. SLO efficiency도 55.1에서 55.2로 유지됐다.

정적 quota는 처리한 작업만 보면 효율이 높지만 9.7%를 거절하고 worst-workspace goodput이 65.7%에
그쳤다. 이는 과부하를 공정하게 분배한 것이 아니라 특정 workspace의 제출 성공률을 낮춘 결과다.

## 6. Scenario별 결과


`Hierarchical + scale` 결과:

| Scenario | Scale activation | Completion goodput | Priority SLO | Worst workspace | Mean end-to-end |
|---|---:|---:|---:|---:|---:|
| Noisy neighbor | 0% | 100% | 100% | 100% | 23.9 sec |
| Sleep/wake burst | 0% | 100% | 100% | 100% | 29.1 sec |
| Elephant and mice | 100% | 100% | 100% | 100% | 80.7 sec |

Scale은 평균 부하 0.93인 두 workload에서 전혀 활성화되지 않았고, 최소 drain time이 439초인
elephant burst에서만 활성화됐다. 이는 quota를 항상 강제하거나 모든 burst에서 scale하지 않고
capacity feasibility에 따라 동작했다는 의미다.

## 7. 민감도


### Scale-up delay

| Delay | Completion goodput | Priority SLO | Worst workspace | Gate pass |
|---:|---:|---:|---:|---:|
| 0 sec | 100.0% | 100.0% | 100.0% | 100.0% |
| 30 sec | 100.0% | 100.0% | 100.0% | 100.0% |
| 60 sec | 100.0% | 99.3% | 99.8% | 93.3% |
| 90 sec | 99.9% | 97.9% | 99.1% | 86.7% |
| 120 sec | 99.6% | 97.9% | 97.8% | 86.7% |

30초는 즉시 scale과 동일한 goodput을 내면서 worker-capacity efficiency가 더 좋았다. 60초부터 일부
seed가 hard gate를 실패했으므로 target은 30초, hard deadline은 60초 미만이다.

### Scale factor

| Factor | Completion goodput | Priority SLO | Worst workspace | P95 | Gate pass |
|---:|---:|---:|---:|---:|---:|
| 1.25× | 98.0% | 99.5% | 92.4% | 138.5 sec | 66.7% |
| 1.50× | 99.1% | 99.9% | 95.8% | 133.2 sec | 73.3% |
| 1.75× | 99.8% | 100.0% | 98.7% | 128.8 sec | 100.0% |
| 2.00× | **100.0%** | **100.0%** | **100.0%** | 118.9 sec | 100.0% |
| 2.50× | 100.0% | 100.0% | 100.0% | 107.4 sec | 100.0% |
| 3.00× | 100.0% | 100.0% | 100.0% | **100.1 sec** | 100.0% |

1.75×도 gate는 통과했지만 2.0×는 평균 worker-capacity가 약 0.2%만 증가하면서 submitted goodput과
worst-workspace goodput을 100%로 만들고 P95를 약 10초 줄였다. 2.5× 이상은 goodput 증가 없이
capacity efficiency만 낮아져 기본값으로 선택하지 않는다.

### Static workspace quota

Burst allowance를 60에서 960 work-seconds까지 늘려도 worst-workspace goodput은 57.3%에서 81.4%로
증가하는 데 그쳤다. 정적 quota는 hard gate를 통과하지 못했으며 독립적인 overload 해결책으로
사용하지 않는다.

## 8. 현재 운영 후보

```text
Normal capacity
  → quota는 soft signal로만 기록
  → Global PSJF + bounded aging

Predicted global drain > 120s
or priority best-case drain > 60s
  → scale 2.0× 요청
  → target 30s, hard deadline < 60s
  → 성공하면 quota borrowing + SLO-aware rescue
  → 실패하면 workspace/priority-aware fallback admission
```

이번 실험에서 `Hierarchical + scale`은 처음으로 모든 adversarial gate를 통과한 후보다. 다만 아래
한계를 검증하기 전에는 실서비스 정책으로 확정하지 않는다.

## 9. 한계

- Scale 성공률을 100%로 가정했다.
- Scale 실패 후 fallback quota와 shed 결과를 아직 같은 hierarchical simulator에서 검증하지 않았다.
- 최소 billing, cold-start 비용과 scale-down debounce를 포함하지 않았다.
- Predictor error와 latency drift가 feasibility trigger를 틀리게 만드는 경우를 아직 측정하지 않았다.
- Retry·checkpoint demand amplification을 hierarchical admission과 결합하지 않았다.
- 실제 TaskAttempt telemetry가 없어 synthetic workload 결과다.
- Workspace weight, 유료 tier와 priority inflation 방어는 아직 없다.

## 10. 다음 연구

다음 실험은 동일 hierarchical candidate에 다음을 추가한다.

1. scale success probability 70–100%
2. hard-deadline fallback quota와 explicit rejection
3. minimum billing과 scale-down cooldown
4. prediction underestimation과 sudden drift
5. retry/checkpoint demand amplification

성공·실패를 같은 workload seed에서 counterfactual pair로 계산해 우연한 scale 성공 표본을 제거한다.

전체 Runtime Predictor prototype pytest 91건과 작업 범위 Ruff 검사가 통과했다.

## 11. 재현 명령

```powershell
cd agent
& '.venv-codex\Scripts\python.exe' -m experiments.runtime_scheduler.plot_hierarchical_scheduler_simulation
& '.venv-codex\Scripts\python.exe' -m pytest experiments/runtime_scheduler/test_hierarchical_scheduler_simulation.py experiments/runtime_scheduler/test_scheduler_plot.py experiments/runtime_scheduler/test_style.py -q
```
