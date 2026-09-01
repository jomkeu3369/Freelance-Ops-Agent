# Scheduler Autoscaling Strategy Experiment

> 실험일: 2026-08-27
> 상태: Synthetic prototype result
> 목적: 지속 과부하에서 Admission 차단과 Worker scale-up을 어떤 순서와 지연으로 결합해야 하는지 검증

## 1. 연구 질문

이전 Admission 실험에서 Priority shed가 지속 과부하의 P95와 복구시간을 가장 크게 줄였지만,
300초 안에 완료된 제출 작업 비율은 69.3%로 목표 95%를 달성하지 못했다. 이번 실험은 다음을
검증한다.

1. Worker를 두 배로 확장하면 부하율 1.96에서 목표 SLO를 달성할 수 있는가?
2. Scale-up 지연이 어느 정도까지 허용되는가?
3. Scale 전에 Priority shed를 수행하는 것이 전체 SLO와 비용 효율에 도움이 되는가?
4. Runtime Predictor로 미리 확장한 이론적 상한은 어느 정도인가?

## 2. 동적 Worker 모델

기존 event-driven Scheduler에 `WorkerCapacityEvent`를 추가했다.

```text
기본 Worker 6개
  → Overload Detector가 predicted drain 120초 초과 감지
  → scale-up delay 경과
  → Worker 12개로 증가
  → 실행 중 Task는 중단하지 않음
  → 새로 비는 Worker slot에만 추가 dispatch
```

Scale-down은 아직 구현하지 않았다. Worker 비용은 첫 Task 도착부터 마지막 Task 완료까지 제공된
`worker_capacity_seconds`로 계산한다. 완전히 사용 중인 탄력적 Worker는 Worker 수가 늘어도 동일한
service work를 더 짧은 시간에 처리하므로 총 worker-seconds가 같을 수 있다. 실제 비용을 평가하려면
다음 단계에서 provision minimum, idle billing과 scale-down cooldown을 포함해야 한다.

## 3. 비교 전략

| Strategy | Admission | Scale-up |
|---|---|---|
| Static accept all | 모두 수락 | 없음 |
| Static priority shed | 과부하 시 낮은 우선순위 차단 | 없음 |
| Reactive scale | 모두 수락 | 감지 60초 후 2배 확장 |
| Shed then scale | 즉시 Priority shed | 감지 60초 후 2배 확장 |
| Predictive scale upper bound | 모두 수락 | 첫 Task 도착 시 즉시 2배 확장 |

모든 전략의 실행 순서는 `Global Predicted-SJF + Aging`으로 고정했다. Completion SLO는 제출 시각부터
300초이며 거절된 Task도 SLO 실패로 계산한다.

## 4. 기본 결과

```yaml
offered_load_ratio: 1.96
base_workers: 6
scaled_workers: 12
scale_up_delay_seconds: 60
paired_seeds: 5
```

| Strategy | Rejected | P95 end-to-end | SLO goodput | Priority 4-5 accepted | Recovery | SLO tasks per 1,000 worker-sec |
|---|---:|---:|---:|---:|---:|---:|
| Static accept all | 0.0% | 1077.1 sec | 54.4% | 100.0% | 1119.1 sec | 19.92 |
| Static priority shed | 26.7% | 299.0 sec | 69.3% | 100.0% | 301.5 sec | **40.61** |
| Reactive scale | 0.0% | 261.2 sec | **97.7%** | 100.0% | 162.6 sec | 33.87 |
| Shed then scale | 5.2% | **183.6 sec** | 94.4% | 100.0% | **105.8 sec** | 34.39 |
| Predictive scale upper bound | 0.0% | 198.9 sec | **99.4%** | 100.0% | 115.4 sec | 33.77 |


## 5. Scale-up 지연 민감도

| Delay | Reactive scale goodput | Reactive P95 | Shed then scale goodput | Shed then scale P95 |
|---:|---:|---:|---:|---:|
| 0 sec | 99.3% | 220.1 sec | 99.0% | 218.5 sec |
| 30 sec | 98.9% | 239.0 sec | 96.0% | 199.5 sec |
| 60 sec | 98.1% | 259.2 sec | 92.6% | 191.1 sec |
| 120 sec | 95.6% | 295.8 sec | 87.5% | 186.0 sec |
| 240 sec | 83.3% | 360.5 sec | 81.4% | 195.9 sec |


## 6. 해석

### Reactive scale이 현재 SLO를 만족하는 기본 후보이다

60초 지연의 Reactive scale은 Task를 거절하지 않고 SLO goodput 97.7%, P95 261.2초를 달성했다.
정적 Admission 정책 중 어느 것도 달성하지 못했던 95% 목표를 통과했다. 따라서 확장 가능한 Worker
환경에서는 Priority shed보다 scale-up이 먼저 실행되어야 한다.

### Scale-up SLA는 120초보다 짧아야 한다

Reactive scale은 120초 지연에서도 goodput 95.6%로 목표를 간신히 통과했지만 P95가 295.8초로
completion SLO에 거의 도달했다. 240초 지연에서는 goodput이 83.3%로 붕괴했다.

초기 운영 기준은 다음과 같이 둔다.

```yaml
scale_trigger_predicted_drain_seconds: 120
scale_up_target_seconds: 60
scale_up_hard_deadline_seconds: 120
scale_factor: 2.0
```

실제 Worker cold start와 Provider quota 확장 시간이 120초를 넘으면 동일 SLO를 보장할 수 없다.

### 즉시 Shed 후 Scale하는 순서는 불필요한 거절을 만든다

Shed then scale은 P95와 복구시간이 가장 짧았지만 5.2%를 거절해 전체 goodput이 94.4%로 목표를
통과하지 못했다. 거절을 실패로 계산하는 제품 SLO에서는 scale이 성공할 수 있는데도 먼저
차단하는 정책이 불리하다.

따라서 운영 순서는 다음이어야 한다.

```text
Overload 감지
  → 즉시 Scale 요청
  → 최대 60초 Grace Window
  → Scale 성공 시 정상 수락 유지
  → 120초 hard deadline까지 Scale 실패 또는 backlog 계속 증가
  → Priority shed 활성화
```

이번 `Shed then scale`은 이 목표 정책의 보수적 하한이며, `Scale then fallback shed`는 다음 실험에서
scale 실패 확률과 함께 별도로 검증해야 한다.

### 비용 효율과 사용자 SLO는 다른 목적함수다

Static priority shed는 단위 worker-second당 SLO 완료량이 40.61로 가장 높았다. 그러나 제출 작업의
26.7%를 거절해 전체 goodput은 69.3%에 그쳤다. 이 정책은 비용 효율 최대화에는 적합하지만 사용자
완료율 SLO에는 부적합하다.

현재 선택 규칙은 다음과 같다.

1. SLO goodput 95%와 high-priority acceptance 99%를 hard gate로 적용한다.
2. Gate를 통과한 전략 중 rejection, P95, worker 비용 순으로 선택한다.
3. 비용 제한이 SLO보다 우선인 별도 서비스 등급에서만 Static priority shed를 허용한다.

## 7. 현재 운영 후보

```text
Predicted backlog Overload Detector
  → Reactive scale request
  → Global Predicted-SJF + Aging
  → Scale SLA 60초
  → Scale hard deadline 120초
  → 실패 시 Priority shed
  → Deadline Rescue Queue
```

현재 synthetic 결과만 기준으로는 `Reactive scale + Global Predicted-SJF + Aging`이 기본 후보이다.
다만 사용자 간 격리, scale failure, cold start 비용과 실제 Provider quota는 아직 검증되지 않았다.

## 8. 한계

- Scale-up은 지정 시각에 항상 성공한다.
- Worker는 동질적이며 모든 Task를 실행할 수 있다.
- Provider quota와 Worker count가 함께 증가한다고 가정한다.
- Scale-down, minimum billing unit과 idle cost가 없다.
- Scaling 중 Task migration이나 preemption은 없다.
- 비용은 토큰 비용이 아니라 worker capacity seconds만 측정한다.
- 실제 workload의 burst duration과 시간대 패턴을 반영하지 않았다.

## 9. 다음 실험

1. Scale 성공·실패 확률이 있는 `Scale then fallback shed`
2. Scale-down cooldown과 idle billing을 포함한 비용 최적화
3. Restart retry와 checkpoint resume의 service demand 증폭
4. 사용자별 reserved capacity와 Provider별 독립 resource pool
5. 실제 execution history 기반 shadow replay

## 10. 재현 방법

```powershell
cd agent
uv run python -m experiments.runtime_scheduler.plot_autoscaling_simulation
uv run pytest experiments/runtime_scheduler/test_autoscaling_simulation.py
```

구현 파일:

- `experiments/runtime_scheduler/autoscaling_simulation.py`
- `experiments/runtime_scheduler/plot_autoscaling_simulation.py`
- `experiments/runtime_scheduler/test_autoscaling_simulation.py`
