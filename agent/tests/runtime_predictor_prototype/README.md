# Runtime Predictor Prototype

이 디렉터리는 운영 Scheduler와 결합하기 전에 runtime regression의 효용과 데이터 경계를
검증하는 실행 가능한 프로토타입이다. 운영 `src/runtime` 코드는 변경하지 않는다.

사용하는 사전 실행 feature는 `task_type`, `model`, `input_tokens`, `context_tokens`,
`file_count`, `subagent_depth`뿐이다. 실제 tool call, output token, retry, 성공 여부와 완료 시각은
로그 metadata로만 남으며 feature matrix에 들어가지 않는다.

```powershell
uv sync --group dev
uv run pytest tests/runtime_predictor_prototype
uv run python -m tests.runtime_predictor_prototype.run_experiment
uv run python -m tests.runtime_predictor_prototype.plot_experiment
uv run python -m tests.runtime_predictor_prototype.plot_ema_experiment
uv run python -m tests.runtime_predictor_prototype.plot_gated_ema_experiment
uv run python -m tests.runtime_predictor_prototype.plot_online_learning_experiment
uv run python -m tests.runtime_predictor_prototype.plot_scheduler_simulation
uv run python -m tests.runtime_predictor_prototype.plot_scheduler_evaluation
uv run streamlit run tests/runtime_predictor_prototype/streamlit_scheduler_simulation.py
```

실험은 고정 seed로 5,000개의 이력을 생성하고 동일 validation set에서 median baseline,
LinearRegression, RandomForestRegressor의 MAE, RMSE, R²를 비교한다. 모델이 median baseline보다
낮은 MAE를 내지 못하면 predictor를 Scheduler에 연결할 근거가 부족한 것으로 판단한다.

## Reproducible result

2026-08-24에 seed 42, train 3,750건, validation 1,250건으로 실행한 결과다.

| Model | MAE | RMSE | R² |
|---|---:|---:|---:|
| Median baseline | 14.76 sec | 26.29 sec | -0.075 |
| LinearRegression | 7.12 sec | 13.26 sec | 0.727 |
| RandomForestRegressor | 4.64 sec | 8.88 sec | 0.877 |
| XGBoost | 3.80 sec | 6.82 sec | 0.928 |

LinearRegression은 baseline 대비 MAE를 약 52%, RandomForestRegressor는 약 69% 줄였다.
XGBoost는 baseline 대비 MAE를 약 74% 줄였으며 세 모델 중 가장 낮은 오차를 기록했다.
따라서 feature pipeline과 predictor interface가 runtime 신호를 학습할 수 있다는 prototype
가설은 통과했다. 다만 synthetic runtime 자체가 이 feature들의 영향을 받도록 생성되므로 이
결과만으로 실제 Sub-Agent workload의 효용을 입증하지는 않는다. 다음 검증은 실제 execution
history를 시간순 holdout으로 나누어 같은 baseline과 비교해야 한다.

`plot_experiment.py`는 Matplotlib으로 실제 runtime histogram, 실제값과 세 모델의 예측값,
예측 runtime 구간별 잔차 표준편차, 모델별 절대오차 box plot을 생성한다.

## Causal EMA residual calibration

EMA는 base prediction 자체를 평균내지 않고, 이전 task들에서 관측된 residual을 보정값으로
사용한다. 현재 task는 반드시 보정값으로 먼저 예측하고 실제 runtime이 확인된 후에만 EMA를
업데이트하므로 미래 target 누수가 없다. 실험의 고정 alpha는 0.1이다.

| Scenario | Model | Base MAE | EMA MAE | Base R² | EMA R² |
|---|---|---:|---:|---:|---:|
| Stationary | LinearRegression | 6.83 sec | 6.90 sec | 0.753 | 0.748 |
| Stationary | RandomForest | 4.39 sec | 4.65 sec | 0.873 | 0.868 |
| Stationary | XGBoost | 3.83 sec | 4.02 sec | 0.915 | 0.911 |
| 30% latency drift | LinearRegression | 7.75 sec | 8.24 sec | 0.740 | 0.733 |
| 30% latency drift | RandomForest | 5.98 sec | 6.23 sec | 0.835 | 0.843 |
| 30% latency drift | XGBoost | 5.34 sec | 5.30 sec | 0.885 | 0.895 |

Stationary workload에서는 residual EMA가 noise까지 추적하여 모든 모델의 MAE를 악화시켰다.
30% drift에서도 XGBoost만 소폭 개선됐다. 따라서 EMA를 기본 예측 경로에 무조건 적용할 근거는
부족하며, drift 감지 후 제한적으로 활성화하거나 예측 오차 monitoring 용도로 사용하는 것이
현재 결과에 부합한다.

## Drift-gated correction experiment

XGBoost base prediction을 유지하면서 상시 EMA, rolling-median residual, drift-gated clipped
EMA를 시간순 validation에서 비교했다. Gate는 clipped signed-residual EMA가 1.5초를 25건
연속 초과한 경우에만 열리며, 보정은 최대 5초이면서 base prediction의 20%를 넘지 않는다.

| Scenario | Strategy | MAE | RMSE | R² | Gate activation |
|---|---|---:|---:|---:|---:|
| Stationary | Base XGBoost | 3.83 sec | 6.88 sec | 0.915 | - |
| Stationary | Always EMA | 4.02 sec | 7.05 sec | 0.911 | - |
| Stationary | Rolling median | 3.85 sec | 6.91 sec | 0.915 | - |
| Stationary | Drift-gated EMA | 3.83 sec | 6.88 sec | 0.915 | None |
| 30% latency drift | Base XGBoost | 5.34 sec | 10.04 sec | 0.885 | - |
| 30% latency drift | Always EMA | 5.30 sec | 9.63 sec | 0.895 | - |
| 30% latency drift | Rolling median | 4.89 sec | 9.50 sec | 0.897 | - |
| 30% latency drift | Drift-gated EMA | 4.87 sec | 9.44 sec | 0.898 | Task 80 |

Drift-gated EMA는 stationary 환경에서 비활성 상태를 유지해 base 성능을 보존했고, drift
환경에서는 gate 활성화 후 네 전략 중 가장 낮은 MAE를 기록했다. 다만 threshold는 synthetic
workload 한 종류에서 정한 값이므로 실제 execution history의 시간순 calibration 구간에서 다시
선정해야 한다.

## Asynchronous online residual learning

XGBoost는 serving model로 고정하고 `SGDRegressor.partial_fit()`이 완료된 task의 base residual을
실시간 학습하는 hybrid 구조를 검증했다. Categorical feature는 고정 크기 hashing으로 변환하고,
numeric feature는 사전 정의된 scale과 interaction으로 변환하므로 새로운 category에도 online
encoder 재학습이 필요 없다.

Replay는 enqueue 시점마다 그 시각 이전에 `completed_at`에 도달한 task만 online model에
반영한다. 따라서 동시에 실행 중이거나 아직 끝나지 않은 task의 target은 현재 예측에 사용되지
않는다.

| Scenario | Strategy | MAE | RMSE | R² |
|---|---|---:|---:|---:|
| Stationary | Base XGBoost | 3.83 sec | 6.88 sec | 0.915 |
| Stationary | XGBoost + online residual SGD | 3.84 sec | 6.89 sec | 0.915 |
| 30% latency drift | Base XGBoost | 5.34 sec | 10.04 sec | 0.885 |
| 30% latency drift | XGBoost + online residual SGD | 4.78 sec | 9.30 sec | 0.901 |

Online residual SGD는 stationary workload에서 성능을 사실상 유지했고, 30% drift에서 base 대비
MAE를 약 10.5% 줄였다. 앞선 drift-gated EMA의 4.87초보다도 낮았다. 다만 online state의
persistence, checkpoint 복구, 업데이트 idempotency, correction rollback과 실제 workload의
시간순 검증이 마련되기 전에는 production 기본 경로로 활성화하지 않는다.

`joblib` artifact는 pickle 계열 포맷이므로 신뢰할 수 있는 내부 파일만 로드해야 한다.

## Multi-workspace scheduler simulation

Runtime Predictor가 정확한지만 보는 데서 그치지 않고 예측값이 실제 queue에 유용한지 검증하기
위해 event-driven scheduler simulator를 추가했다. 같은 task stream에서 다음 정책을 비교한다.

```text
FIFO
Global Predicted-SJF
Global Predicted-SJF + Aging
Fair FIFO
Fair Predicted-SJF
Fair Predicted-SJF + Aging
Oracle-SJF
```

Global과 Fair 정책을 분리해 runtime ordering의 효과와 workspace virtual-service 선택의 효과가
섞이지 않도록 했다. Fair 계열은 먼저 누적 virtual service가 가장 적은 workspace를 선택한 뒤
해당 workspace 내부 task를 선택한다. Oracle은 실제 runtime을 미리 아는 운영 정책이 아니라
prediction으로 도달할 수 있는 이론적 하한 비교군이다.

측정 지표:

```text
mean queue wait
p95 queue wait
mean completion time
p95 completion time
workspace Jain fairness index
max-wait 초과 task 수
maximum observed queue wait
Oracle 대비 scheduler regret
cache hit 수
```

cache hit task는 worker pool을 점유하지 않고 즉시 완료된다. Predictor 학습 표본에는 cache miss
후 실제 실행된 task만 사용한다. `plot_scheduler_simulation.py`는 여러 seed의 평균과 95% 신뢰
구간을 `scheduler_policy_comparison.png`에 저장한다. 같은 script는 저부하, 용량 근접, 과부하,
예측 노이즈와 높은 cache hit 조건을 비교한 `scheduler_stress_test.png`도 생성한다. offered load가
1을 넘으면 장기적으로 도착하는 service demand가 Worker 처리 용량을 초과한다는 뜻이므로 해당
결과는 정상 운영값이 아니라 overload stress test로 해석한다.

Streamlit 화면에서는 workspace 수, worker 수, arrival rate, burst, latency drift, prediction
noise, cache hit rate, max wait, aging과 반복 seed 수를 바꾸면서 정책별 대기시간·공정성·regret와
workspace별 결과를 확인할 수 있다. Streamlit의 `cache_data`를 사용해 동일 parameter 조합의
반복 학습과 replay를 피한다.

## Scheduler benchmark result

2026-08-26에 workspace 6개, worker 6개, workspace당 task 80개, cache hit 10%, latency drift
30%와 seed 5개로 실행한 결과다. offered load는 `0.94 ± 0.02`로 Worker 용량에 가까운 조건이다.
Prediction 성능은 MAE `5.84 ± 0.25초`, RMSE `10.86 ± 1.96초`, R² `0.845 ± 0.036`이었다.

| Policy | Mean completion | P95 wait | P99 wait | Maximum wait | Fairness | Wait violations | Priority violations |
|---|---:|---:|---:|---:|---:|---:|---:|
| FIFO | 123.33 sec | 198.49 sec | 214.28 sec | 226.98 sec | 0.941 | 41.21% | 59.73% |
| Global Predicted-SJF | 63.49 sec | 172.69 sec | 637.18 sec | 1125.67 sec | 0.971 | 6.17% | 6.61% |
| Global Predicted-SJF + Aging | 88.63 sec | 221.10 sec | 256.95 sec | 288.95 sec | 0.989 | 23.12% | 29.56% |
| Fair FIFO | 120.79 sec | 626.10 sec | 1082.09 sec | 1366.53 sec | 0.688 | 15.83% | 9.71% |
| Fair Predicted-SJF | 82.56 sec | 297.73 sec | 884.77 sec | 1322.77 sec | 0.798 | 10.08% | 13.32% |
| Fair Predicted-SJF + Aging | 97.93 sec | 416.97 sec | 844.56 sec | 1036.36 sec | 0.762 | 15.58% | 19.46% |
| Oracle-SJF | 61.91 sec | 168.34 sec | 597.87 sec | 1153.98 sec | 0.978 | 6.21% | 6.12% |

Global Predicted-SJF는 mean completion에서 Oracle에 가장 가까웠지만 p99와 maximum wait가 크게
증가했다. Global Predicted-SJF + Aging은 maximum wait를 300초 아래로 제한했지만 mean과 priority
SLO 위반율을 희생했다. 따라서 단일 평균값으로 승자를 정하지 않고 SLO를 먼저 적용한다.

기본 hard gate는 P95 wait 120초 이하, maximum wait 300초 이하, Jain fairness 0.90 이상,
120초 wait 위반율 1% 이하, priority 4-5 작업의 60초 wait 위반율 1% 이하이다. 부하 0.94에서는
6개 운영 정책 중 모든 seed에서 다섯 기준을 전부 통과한 정책이 없었다. 이 조건에서는 정책을
선택하지 않고 Worker 증설, admission control 또는 SLO 재협의가 먼저라는 결론이다.

Fairness 값은 workspace별 inverse mean slowdown에 대한 Jain index다. burst workspace를
의도적으로 제한하면 해당 workspace의 slowdown이 커져 이 값이 낮아질 수 있으므로 단독으로
공정성을 판정하지 않는다. max-wait violation, maximum wait와 workspace별 service share를 함께
검토해야 한다.

### Stress scenarios

| Scenario | Offered load | Predicted-SJF mean wait | Aging mean wait | Predicted maximum wait | Aging maximum wait |
|---|---:|---:|---:|---:|---:|
| Under capacity | 0.60 | 3.18 sec | 3.28 sec | 101.50 sec | 79.97 sec |
| Near capacity | 0.95 | 53.31 sec | 72.16 sec | 1091.68 sec | 886.71 sec |
| Overloaded | 1.99 | 199.67 sec | 265.77 sec | 1390.10 sec | 1204.98 sec |
| Noisy prediction | 0.95 | 60.54 sec | 76.01 sec | 1099.63 sec | 940.85 sec |
| High cache hit | 0.53 | 0.74 sec | 0.74 sec | 35.04 sec | 35.04 sec |

부하가 낮으면 정책 차이는 작고, 용량 근처에서 runtime prediction의 효용이 가장 커졌다.
추가 prediction noise는 mean wait를 악화시켰지만 Predicted-SJF의 이점이 즉시 사라지지는 않았다.
offered load가 1을 크게 넘는 경우 어떤 정렬 정책도 지속적인 queue 증가를 해결할 수 없으므로
admission control, backpressure 또는 Worker 확장이 필요하다. 높은 cache hit 조건은 Worker에
도달하는 service demand 자체를 줄여 가장 큰 대기시간 감소를 보였다.

### SLO robustness result

`scheduler_multidimensional_evaluation.png`는 mean completion, P95, maximum wait, fairness, wait
위반율과 high-priority 위반율을 SLO 기준선과 함께 표시한다. `scheduler_slo_stress_heatmap.png`는
정책마다 다섯 SLO 중 통과한 개수와 모든 SLO를 통과한 seed 비율을 부하 조건별로 표시한다.

- 저부하 `ρ=0.60`에서는 FIFO, Global Predicted-SJF + Aging과 Fair FIFO가 모든 seed에서 통과했다.
- 높은 cache hit로 부하가 `ρ=0.53`까지 낮아지면 모든 운영 정책이 통과했다.
- 용량 근접 `ρ=0.95`, prediction noise와 과부하 `ρ=1.99`에서는 통과 정책이 없었다.
- 저부하에서 여러 정책이 통과하면 hard gate 이후 mean completion이 가장 짧은 Global
  Predicted-SJF + Aging이 선택됐다.

현재 fairness는 workspace별 inverse mean slowdown에 대한 Jain index다. Global 정책도 workload가
대칭이면 높은 값을 얻을 수 있으므로 tenant isolation을 충분히 증명하지 않는다. 다음 단계에서는
workspace별 보장 service share, worst-workspace P99와 adversarial burst workload를 hard gate에
추가해야 한다.

2026-08-26 최종 검증에서는 Runtime Predictor와 Scheduler·plot·Streamlit AppTest를 포함한
pytest 37건과 작업 범위 Ruff 검사가 통과했다.
