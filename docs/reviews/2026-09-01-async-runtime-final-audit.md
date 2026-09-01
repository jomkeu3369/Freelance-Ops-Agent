# Async Runtime 전체 설계·구현 감사

> 감사일: 2026-09-01  
> 기준 커밋: `de70aeb3d0bbcb4a3eb4686f5aba0c25d5f6df10`  
> 범위: Deep Agent 오케스트레이션, 요청 라우팅, Task 제어, 신뢰성, Scheduler shadow, 평가·학습 승격, 운영 준비

## 1. 결론

Phase 0~10에서 계획한 소프트웨어 구현과 자동 검증은 완료되었다. 공개 제어 영역은 Spring이,
실행 상태는 Python Agent의 `agent_runtime` schema가 소유하며 command/event Outbox로 연결된다.
실제 dispatch는 계속 `fifo-v1`이고 예측 기반 Scheduler는 shadow 상태이므로, 검증되지 않은 정책이
운영 순서·권한·비용·provider를 바꾸지 않는다.

현재 판정은 **구현 완료, 제한적 파일럿 준비 완료, 운영 승격 보류**다. 최소 7일·1,000건의 실제 실행,
실제 provider 장애 표본, 부하·복구 훈련과 독립 승인이 아직 없으므로 기존 AgentRun fallback과
`legacy/v1`을 제거하거나 Scheduler를 active로 전환해서는 안 된다.

## 2. 설계 대 구현 추적표

| 설계 영역 | 구현 근거 | 판정 |
|---|---|---|
| 공개 API·인증·역할 기반 제어 | Spring `agenttask` controller/service/security, workspace·run·task scope 재검증 | 완료 |
| 의미·위험도 라우팅 | 결정론적 route/model/tool profile, 고위험 요청 `HUMAN_REQUIRED` fail-closed | 완료 |
| 감독·전문 Agent | bounded Research specialist, read-only Tool, citation 독립 검증 | 첫 전문 경로 완료 |
| Task 계약·권한·예산 | immutable execution profile, revision·정책·권한·예산 재검증 | 완료 |
| 일시정지·수정·취소 | durable command, checkpoint 시 soft update, redirect/cancel fencing | 완료 |
| 행동 관문 | read-only allowlist와 SSRF·prompt-injection 방어 적용 | 현재 read-only 범위 완료 |
| 영속 Task·Attempt | Spring 업무 registry와 Agent 실행 registry 분리, versioned migration | 완료 |
| 명령·이벤트 전달 | 양쪽 Outbox, lease·ACK fencing, idempotent projection | 완료 |
| Checkpoint·Retry·Circuit | token hash, 계층형 token bucket, 다중 신호 분류, provider circuit | 완료 |
| Queue·Scheduler | PostgreSQL FIFO claim/lease, resource pool 격리, PSJF+aging shadow | shadow 완료 |
| Replay·학습 승격 | 권위 데이터 assembler, MAE/P95/R²·SLO·공정성 gate, immutable release evidence | 완료 |
| 관측·운영 대응 | payload 없는 aggregate snapshot, SLO, 장애 대응·rollback runbook | 구현 완료 |
| 자동 확장·보조 provider | shadow 신호와 circuit만 기록, 실제 자동 변경 없음 | 의도적 보류 |

## 3. 핵심 안전성 감사

### 데이터와 tenant 경계

- Spring의 `app` schema와 Agent의 `agent_runtime` schema 소유권이 분리되어 있다.
- Task, Attempt, command, event와 Scheduler claim은 workspace·run·revision identity로 fencing된다.
- 이전 revision의 event와 완료 결과는 감사 원장에는 남지만 현재 projection을 변경하지 않는다.
- startup은 schema를 자동 생성하지 않고 Alembic/Flyway migration 존재를 검증한다.

### 권한과 외부 행동

- Routing 결과를 TaskGuard가 현재 RBAC, delegation, 정책, 예산과 모델 선택으로 다시 검증한다.
- 현재 전문 작업자는 read-only이며 범용 sub-agent, shell, write Tool과 재귀 위임을 노출하지 않는다.
- 권한이나 비용 계약을 확장할 수 있는 자동 secondary provider 전환은 비활성 상태다.
- prompt, chain-of-thought, credential, delegation token과 원문 resume token은 event에 저장하지 않는다.

### 동시성과 장애 복구

- 실제 queue는 `FOR UPDATE SKIP LOCKED`와 lease를 사용하며 경쟁 worker 중 하나만 claim한다.
- lease 만료 시 같은 queue row와 attempt identity를 회수하고 Task/Attempt를 복제하지 않는다.
- checkpoint 상태와 Outbox event, retry token 소비와 결정 snapshot은 각각 같은 transaction 경계에 있다.
- command와 event ACK는 claim identity를 검사해 만료 worker의 늦은 응답을 차단한다.

### 학습·Scheduler 승격

- 실제 순서는 `fifo-v1`이며 shadow의 defer, reject, scale 판단은 상태를 변경하지 않는다.
- 빈 데이터, 필드 누락, 관측 coverage 부족과 shadow metric 부재는 자동으로 `SHADOW_ONLY`가 된다.
- release는 artifact SHA, dataset fingerprint, 전체 gate report와 policy version에 결합된다.
- 현재 표 형식 회귀 학습은 CPU에서 수십 초 수준이므로 외부 GPU 비용을 사용할 근거가 없다.

## 4. 검증 증거

| 검증 | 최종 결과 |
|---|---:|
| Agent 전체 테스트 | 406 passed, 6 skipped |
| Phase 10 대상 테스트 | 12 passed, 1 skipped |
| Ruff | 통과 |
| strict Mypy | 75 source files 통과 |
| Python SDK | 2 tests 통과 |
| 라우팅 릴리스 평가 gate | 통과 |
| GitHub Python·PostgreSQL 통합 CI | 통과 |
| GitHub Agent image | 통과 |
| Phase별 PR | #4~#11, #13, #14 병합 완료 |

로컬 skip은 외부 PostgreSQL URL 등 조건이 필요한 테스트이며 PR CI에서 pgvector PostgreSQL 통합
검증을 수행했다. Phase 10 병합 전 헤드 SHA는
`e3706ee80e2bbc5a39a96d76dfb1d2afc09f212d`로 고정했다.

## 5. 발견 사항과 잔여 위험

### 운영 승격 차단 항목

1. 최소 7일·1,000 terminal attempts의 production pilot 데이터가 없다.
2. 실제 provider incident label과 circuit probe SLO 표본이 없다.
3. Vultr immutable image rollback과 backup restore drill을 수행하지 않았다.
4. 실제 네트워크에서 k6 queue age, DB lock, SSE/polling 부하를 측정하지 않았다.
5. PR 작성자와 동일 계정의 공식 승인은 GitHub가 거부하므로 독립 reviewer 승인이 필요하다.

### 의도적으로 남긴 기능 경계

- Supervisor의 다부서 병렬 실행과 추가 specialist는 현재 첫 read-only Research 경로 이후 범위다.
- write side effect용 Action Gateway는 `BOUNDED_WRITE`가 계속 fail-closed이므로 별도 설계·승인이 필요하다.
- 조건부 autoscale, secondary provider failover와 Scheduler active admission은 운영 gate 통과 전까지
  활성화하지 않는다.
- 기존 AgentRun fallback과 `legacy/v1`은 rollback 근거가 확보될 때까지 유지한다.

위 항목은 현재 구현의 결함을 숨기는 예외가 아니라 운영 승격 전에 충족해야 할 명시적 조건이다.

## 6. 권고 진행 순서

1. 제한된 workspace와 read-only Research 작업으로 7일·1,000건 shadow pilot을 수행한다.
2. 운영 snapshot과 release report로 queue age, lease, 예측 오차, SLO와 workspace 공정성을 검토한다.
3. provider 장애 주입, checkpoint resume, cancel, immutable image rollback과 backup restore drill을 수행한다.
4. 독립 reviewer가 증거와 runbook을 승인한 뒤 predictor 또는 Scheduler를 각각 별도 release로 승격한다.
5. 승격 후에도 fallback을 유지하고, 중복 side effect·tenant 위반·만료 lease가 모두 0일 때만 레거시
   제거 PR을 별도로 검토한다.

## 7. 최종 판정

```yaml
implementation_sequence: COMPLETE
automated_regression: PASSED
limited_read_only_pilot: READY
production_scheduler_promotion: BLOCKED_PENDING_EVIDENCE
legacy_removal: NOT_AUTHORIZED
external_gpu_training: NOT_NEEDED
```
