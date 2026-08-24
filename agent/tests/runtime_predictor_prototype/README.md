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
