# TaskAttempt Telemetry Shadow Contract 실험 보고서

작성일: 2026-08-27
상태: Versioned contract와 defect-injection 검증 완료, production event 수집 전

## 1. 목적

앞선 Scheduler 실험은 합성 TaskAttempt history를 직접 simulator에 주입했다. 실제 서비스에서는
Worker와 Dispatcher가 생성한 이벤트를 durable store에서 읽어 동일한 attempt history로 재구성할 수
있어야 한다. 데이터가 누락되거나 사후 정보가 decision-time snapshot에 섞이면 shadow replay 결과는
정확해 보여도 운영 의사결정에 사용할 수 없다.

이번 실험은 다음을 검증한다.

1. 비동기·순서가 뒤바뀐 수신에서도 source sequence로 TaskAttempt를 정확히 재구성하는가?
2. Prediction feature와 최종 runtime·incident label이 분리되는가?
3. Retry classifier와 token bucket 결정이 사후에 감사 가능한 snapshot으로 남는가?
4. 누락·중복·시간 역행·회계 오류·secret 저장을 replay 전에 차단하는가?
5. Telemetry ingestion 지연이 어느 지점에서 warning 또는 hard reject가 되는가?

## 2. 현재 저장소의 실제 공백

아키텍처 문서에는 `agent_task_attempt`와 `agent_task_event`가 정의되어 있지만 현재 Python runtime의
공개 계약은 run 단위 `AgentRunEvent`와 누적 usage를 중심으로 한다. Production DB에 TaskAttempt별
prediction snapshot, retry token snapshot과 final incident label을 저장하고 방출하는 구현은 아직 없다.

따라서 이번 결과가 증명하는 것은 다음 두 가지다.

- TaskAttempt event contract가 shadow replay 입력으로 조립될 수 있다.
- 정의한 결함을 strict validator가 차단한다.

실제 Worker event의 completeness, throughput과 clock behavior는 아직 증명하지 않는다.

## 3. Versioned event contract

Schema version:

```text
task-attempt-telemetry-v1
```

모든 이벤트의 공통 envelope:

```text
schema_version
event_id
source_event_id
task_id
attempt_id
attempt_number
workspace_id
sequence
event_type
occurred_at
received_at
data
```

`event_id`와 `source_event_id`는 유일해야 한다. `(attempt_id, sequence)`는 1부터 연속되어야 하며,
`occurred_at`은 sequence 순서에서 감소할 수 없다. `received_at` 순서는 보장하지 않고 source sequence를
권위로 사용한다.

## 4. Attempt lifecycle

```text
attempt.predicted
  -> attempt.queued
  -> attempt.started
  -> attempt.checkpointed optional
  -> attempt.completed

or

attempt.predicted
  -> attempt.queued
  -> attempt.started
  -> attempt.failed
  -> attempt.retry_decided
  -> attempt.incident_finalized optional and post-decision only
```

각 attempt에는 prediction, queued, started와 정확히 하나의 terminal event가 있어야 한다. Retry attempt는
이전 attempt가 실패하고 `ALLOW` 결정을 받은 후 `retry_ready_at`보다 이르지 않게 queue되어야 한다.

Prediction event에는 실행 전에 알 수 있는 값만 저장한다.

```text
task_type
model
input_tokens
context_tokens
file_count
subagent_depth
feature_snapshot_at
predicted_runtime_seconds
predictor_version
checkpoint_restored_seconds
```

`feature_snapshot_at <= predicted_at <= queued_at <= started_at`을 강제한다. 실제 runtime과 success는
terminal event에서만 확정한다.

## 5. Retry decision snapshot

Retry 결정은 다음 데이터를 원자적으로 기록한다.

```text
decision
reason
failure_classification
classification_confidence
classifier_version
bucket_policy_version
workspace_tokens_before
workspace_tokens_after
global_tokens_before
global_tokens_after
retry_ready_at
```

Hierarchical retry를 허용하면 workspace token과 global token을 각각 정확히 1개 소비해야 한다. 거부하면
token을 소비하지 않는다. `WORKSPACE_BUCKET_EMPTY`, `GLOBAL_BUCKET_EMPTY`와 circuit-open reason은 각각
관측 snapshot과 일치해야 한다.

`final_incident_kind`와 `final_label_source`는 retry 결정에 포함할 수 없다. 이는 incident 종료 후
`attempt.incident_finalized`에서만 기록한다.

## 6. 보안·데이터 누수 규칙

Event data의 모든 깊이에서 다음 key를 거부한다.

```text
api_key
chain_of_thought
delegation_token
prompt
secret
```

Retry classifier와 Runtime Predictor는 원문 prompt나 모델의 chain-of-thought 없이 구조화된 feature와
reason code만 기록한다.

## 7. 결함 주입 실험

- 20개 seed
- Seed당 60 task
- Retry 발생률 25%
- Clean stream과 12가지 transport·schema·leakage 조건
- 정상 stream과 receive reordering은 accept 대상
- 나머지 결함은 strict reject 대상

| 조건 | 예상 | 관측 | 올바른 처리 | Replay fidelity |
|---|---:|---:|---:|---:|
| Clean stream | Accept | 100% accept | 100% | 100% |
| Receive reordering | Accept | 100% accept | 100% | 100% |
| Duplicate source event | Reject | 100% reject | 100% | Replay 차단 |
| Missing prediction | Reject | 100% reject | 100% | Replay 차단 |
| Sequence gap | Reject | 100% reject | 100% | Replay 차단 |
| Occurred-time regression | Reject | 100% reject | 100% | Replay 차단 |
| Excessive ingestion delay | Reject | 100% reject | 100% | Replay 차단 |
| Feature snapshot leakage | Reject | 100% reject | 100% | Replay 차단 |
| Secret field leakage | Reject | 100% reject | 100% | Replay 차단 |
| Runtime mismatch | Reject | 100% reject | 100% | Replay 차단 |
| Retry token mismatch | Reject | 100% reject | 100% | Replay 차단 |
| Final-label leakage | Reject | 100% reject | 100% | Replay 차단 |
| Retry without decision | Reject | 100% reject | 100% | Replay 차단 |

Clean stream과 수신 순서가 뒤바뀐 stream 모두 runtime과 predicted runtime의 평균 재구성 오차가
0초였다. Invalid stream은 부분 데이터로 counterfactual scheduling을 실행하지 않는다.

## 8. Ingestion delay 경계

| 모든 event의 지연 | Dataset accept | Warning event | Mean errors |
|---:|---:|---:|---:|
| 0s | 100% | 0% | 0.0 |
| 10s | 100% | 0% | 0.0 |
| 30s | 100% | 0% | 0.0 |
| 60s | 100% | 100% | 0.0 |
| 180s | 100% | 100% | 0.0 |
| 300s | 100% | 100% | 0.0 |
| 301s | 0% | 0% | 165.5 |
| 600s | 0% | 0% | 165.5 |

현재 provisional rule은 `delay > 30초` warning, `delay > 300초` replay reject다. 정확히 30초와 300초는
각각 warning과 reject 경계 안쪽이다. 301초에서 error 수가 큰 이유는 stale dataset 전체가 아니라
각 stale event를 감사 가능하게 보고하기 때문이다.

이 지연값은 production SLO가 아니다. 실제 event broker와 DB p99를 측정한 뒤 warning은 정상 p99보다
충분히 크게, hard limit은 운영 의사결정 freshness보다 작게 다시 보정해야 한다.

## 9. Plot

### 결함별 검증 Plot 표


### Ingestion delay 경계


## 10. 운영 연결

```text
Worker / Dispatcher
  -> append-only TaskAttempt events
  -> unique source_event_id deduplication
  -> durable PostgreSQL event store
  -> telemetry validator
     -> invalid: quarantine + alert, never replay
     -> valid: assemble ShadowTaskAttempt
  -> observed-order replay
  -> counterfactual Scheduler policies
  -> promotion gate
```

Raw event와 assembled attempt를 같은 transaction에서 억지로 갱신하지 않는다. Raw event는 immutable
source이고 assembled attempt는 재생성 가능한 projection이다. Final incident adjudication은 prediction과
retry decision을 수정하지 않고 별도 finalization event를 append한다.

## 11. Production acceptance gate

실제 수집기가 다음을 만족하기 전에는 Scheduler 정책을 production dispatch에 연결하지 않는다.

```yaml
duplicate_source_event_rate: 0
sequence_gap_rate: 0
required_event_completeness: 100%
runtime_timestamp_mismatch_rate: 0
decision_time_label_leakage_rate: 0
secret_field_rejection_rate: 100%
retry_token_accounting_mismatch_rate: 0
clean_reconstruction_fidelity: 100%
telemetry_p99_delay: "measured and below calibrated warning limit"
```

## 12. 현재 한계

- 실제 production event가 아닌 production-shaped synthetic event다.
- Event persistence, transaction outbox와 broker redelivery를 구현하지 않았다.
- Clock skew는 2초 허용값만 두었고 host별 NTP 상태를 측정하지 않았다.
- Validator는 schema semantics를 검증하지만 이벤트 서명이나 producer identity를 인증하지 않는다.
- 301초 이상 지연 event가 많을 때 issue cardinality를 제한하는 quarantine 요약이 아직 없다.
- Runtime-weighted retry token과 cost ledger event는 아직 결합하지 않았다.

## 13. 다음 단계

1. `agent_task_attempt`와 `agent_task_event` migration 확정
2. Dispatcher prediction·queue event와 Worker started·terminal event emitter 구현
3. Transactional outbox 또는 동일 DB append를 이용한 event loss 방지
4. 실제 event를 JSONL 또는 query snapshot으로 추출해 strict validator 실행
5. 실제 completeness·duplicate·delay 분포 Plot 작성
6. 통과한 데이터만 기존 Scheduler shadow replay에 연결

## 14. 재현 방법

```powershell
cd agent
$env:PYTHONPATH = "$PWD\.venv\Lib\site-packages"
.\.venv-codex\Scripts\python.exe -m pytest experiments\runtime_scheduler\test_task_attempt_telemetry.py experiments\runtime_scheduler\test_task_attempt_telemetry_experiment.py -q
.\.venv-codex\Scripts\python.exe -m experiments.runtime_scheduler.plot_task_attempt_telemetry
```

관련 구현:

- `experiments/runtime_scheduler/task_attempt_telemetry.py`
- `experiments/runtime_scheduler/task_attempt_telemetry_experiment.py`
- `experiments/runtime_scheduler/plot_task_attempt_telemetry.py`
- `experiments/runtime_scheduler/test_task_attempt_telemetry.py`
- `experiments/runtime_scheduler/test_task_attempt_telemetry_experiment.py`

검증 결과:

```text
pytest experiments/runtime_scheduler -q -p no:cacheprovider: 137 passed
ruff check experiments/runtime_scheduler: All checks passed
```
