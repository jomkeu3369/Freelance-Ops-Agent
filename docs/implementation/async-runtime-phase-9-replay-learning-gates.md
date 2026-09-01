# Async Runtime Phase 9 · Replay 조립, 학습 승격 Gate와 관측성

## 1. 구현 경계

Phase 9는 운영 TaskAttempt, Scheduler entry와 Worker capacity event를 권위 데이터로 조립하고,
Runtime Predictor 또는 Scheduler 정책을 승격할 수 있는지 fail-closed 평가한다. 모델 학습 자체는 기존
XGBoost/RF prototype을 유지하며, 실제 데이터 준비도 gate가 통과하기 전에는 synthetic 결과만으로
운영 release를 승인하지 않는다.

현재 구조화 회귀는 CPU에서 수십 초 수준이므로 로컬 RTX 5060 Ti 16GB나 Vast.ai GPU를 사용하지
않는다. 향후 encoder fine-tuning이 별도 승인되면 로컬 GPU를 먼저 사용한다.

## 2. 권위 데이터 조립

`PostgresRuntimeEvaluationStore`는 지정 시간 구간에서 다음 테이블을 결합한다.

```text
agent_task_attempt
  + agent_task
  + agent_scheduler_entry
  + agent_worker_capacity_event
```

완료 또는 실패한 attempt의 queue/start/finish, prediction, predictor version, priority, workspace,
retry reason과 resource pool을 고정형 평가 record로 만든다. resource pool별 평가에서는 다른 provider
또는 model pool을 섞지 않는다. Scheduler entry가 없는 terminal attempt는 dataset에서 조용히
사라지지 않도록 source terminal count 대비 observation coverage gate로 차단한다.

## 3. 데이터 준비도 Gate

기본 정책 `runtime-promotion-v1`은 다음을 모두 요구한다.

```yaml
minimum_attempts: 1000
minimum_observation_days: 7
minimum_load_bands: 3
required_field_missing_count: 0
scheduler_observation_coverage: 1.0
prediction_coverage: ">= 0.95"
predictor_version_coverage: 1.0
retry_reason_coverage: ">= 0.99"
```

queue/start/finish가 없거나 시간 순서가 잘못된 record는 required field 누락으로 계산한다. 빈 dataset,
관측되지 않은 terminal attempt와 predictor version 누락은 자동 보정하지 않는다.

## 4. Predictor Gate

실제 service runtime은 `finished_at - started_at`이며 queue wait를 target에 포함하지 않는다.

```yaml
MAE: "<= 6 sec"
P95 absolute error: "<= 15 sec"
R2: ">= 0.80"
```

단일 표본이나 actual variance가 0인 dataset은 R²를 계산할 수 없으므로 승인되지 않는다. 이는 작은
표본의 완벽한 MAE만으로 release가 승격되는 것을 막는다.

## 5. Scheduler Replay 승격 Gate

Counterfactual shadow replay metric이 전달되지 않으면 `shadow_metrics_available` gate가 실패한다.
전달된 후보는 다음을 모두 만족해야 한다.

```yaml
submitted_completion_goodput: ">= 0.95"
priority_wait_slo_goodput: ">= 0.95"
worst_workspace_completion_goodput: ">= 0.90"
workspace_fairness: ">= 0.90"
maximum_wait_seconds: "<= 300"
```

평균 latency만으로 승격하지 않는다. 모든 gate가 통과한 경우에만 `APPROVED`, 그 외에는
`SHADOW_ONLY`다. 명시적 운영 폐기 기록에는 `REJECTED`를 사용할 수 있지만 평가 실패가 자동으로
데이터를 삭제하지 않는다.

## 6. 증거 결합 Release Registry

`agent_runtime_release`는 다음을 하나의 immutable release evidence로 저장한다.

- `RUNTIME_PREDICTOR` 또는 `SCHEDULER_POLICY`
- version과 resource pool
- artifact reference와 SHA-256
- 정렬 독립적인 dataset fingerprint SHA-256
- 전체 gate report와 policy version
- `SHADOW_ONLY / APPROVED / REJECTED`, 승인 시각

동일 kind/version/resource pool은 같은 release ID, artifact, dataset과 report status일 때만 멱등
성공한다. 다른 증거로 덮어쓸 수 없다. 비정상 무한대 metric은 JSONB에 숫자로 저장하지 않고 null로
정규화하며 해당 gate는 실패 상태로 보존한다.

## 7. 관측 결과

평가 report는 record 수, 관측 일수, load band, 누락 수, Scheduler coverage, retry reason coverage,
predictor MAE/P95/R², observed Scheduler SLO·공정성·maximum wait와 모든 개별 gate 결과를 제공한다.
이 report가 Phase 10 운영 dashboard와 alert의 권위 입력이 된다.

## 8. 검증

- Shadow replay metric 부재 시 `SHADOW_ONLY` 유지
- 모든 데이터·predictor·scheduler gate 통과 시에만 `APPROVED`
- timestamp 누락, predictor 회귀와 Scheduler observation gap 차단
- dataset 순서와 무관한 fingerprint
- ORM release evidence 제약과 PostgreSQL assembler/release 멱등성 통합 테스트
- Alembic 정·역방향 SQL 생성
