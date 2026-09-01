# Async Runtime Phase 10 · 운영 준비와 레거시 경계

## 1. 완료 범위

- resource pool별 queue·retry·lease·shadow·circuit·release 운영 snapshot
- 실제 PostgreSQL 동시 claim에서 단일 소유권과 lease 만료 회수 검증
- production runtime의 prototype, Redis, Kafka, FAISS, MongoDB import 금지 검사
- schema 자동 생성 금지와 migration table 검증 유지
- Async Runtime SLO 및 장애·rollback runbook

## 2. 의도적으로 유지한 경계

기존 AgentRun fallback은 실제 production pilot과 runtime release gate 통과 전까지 삭제하지
않는다. V1 source snapshot은 저장소 정리 결정에 따라 Git history로 이관했으며 rollback에 필요한
운영 경로는 active source에 유지한다. fallback 제거는 여전히 아래 조건을 충족한 별도 PR에서만
검토한다.

다음 조건을 모두 충족한 별도 PR에서만 기존 경로 제거를 검토한다.

```yaml
production_observation_days: ">= 7"
terminal_attempts: ">= 1000"
runtime_release: APPROVED
checkpoint_resume_duplicate_side_effects: 0
cross_workspace_access_violations: 0
expired_lease_after_recovery: 0
rollback_drill: passed
```

## 3. 운영 Snapshot

`PostgresRuntimeOperationalMetrics`는 payload 원문 없이 aggregate만 반환한다. 조회는 상태를 변경하지
않으며 resource pool 경계를 적용한다. provider circuit은 공유 외부 장애 신호이므로 전체 OPEN과
HALF_OPEN 수를 함께 표시한다.

## 4. 부하·동시성 경계

PostgreSQL queue claim은 `FOR UPDATE SKIP LOCKED`와 lease를 사용한다. 동일 entry에 두 Worker가 동시에
claim해도 하나만 소유하며, lease 만료 후에는 같은 row와 attempt identity로 회수한다. 새 Task 또는
Attempt를 복제하지 않는다.

실제 인터넷·Vultr 부하와 restore drill은 외부 환경과 비용 승인이 필요한 운영 검증으로 남긴다.
현재 CI는 pgvector PostgreSQL concurrency와 전체 계약 회귀를 수행한다.

## 5. 보안 경계

- runtime은 `experiments/runtime_scheduler`를 import하지 않는다.
- Redis, Kafka, FAISS, MongoDB/Beanie는 production runtime dependency가 아니다.
- Agent startup은 `create_all`을 호출하지 않고 Alembic migration 존재를 검증한다.
- prompt, chain-of-thought, secret, delegation token과 raw resume token은 event에 저장하지 않는다.
- Python Agent는 Spring `app` 업무 schema를 직접 소유하지 않는다.

## 6. 남은 외부 검증

- 최소 7일·1,000 terminal attempts production pilot
- 실제 provider incident label과 circuit probe SLO
- Vultr immutable image rollback 및 backup restore drill
- 실제 k6 부하에서 queue age, DB lock, SSE/polling 부하 측정
- 독립 reviewer가 필요한 branch protection의 공식 승인
