# Phase 11D · 제한적 Research FIFO Pilot 증거와 승격 심사

## 1. 현재 판정

현재 저장소에는 실제 운영 7일·1,000 terminal attempts, immutable image rollback, backup restore와
실제 네트워크 부하 테스트 증거가 없다. 따라서 현재 판정은 `HOLD`이며 dispatcher 기본값은
비활성이다. synthetic 데이터, 로컬 skip 또는 문서상 체크 표시는 운영 증거로 대체하지 않는다.

## 2. Pilot 범위

- resource pool과 specialist profile은 모두 `research-read-v1`이다.
- `AGENT_FIFO_DISPATCHER_WORKSPACE_ALLOWLIST`에 등록한 UUID workspace만 FIFO worker를 사용한다.
- 기본 정책상 workspace는 최대 5개이며 실제 시작 시 더 작은 범위를 우선한다.
- 실행 권한은 `agent.run`과 read permission만 허용하며 write-capable Task는 0건이어야 한다.
- allowlist 밖 workspace는 기존 Task shadow와 AgentRun fallback lifecycle을 유지한다.
- `AGENT_FIFO_DISPATCHER_ENABLED` 기본값은 `false`다.

Allowlist는 배포 환경 설정으로만 제공하고 실제 workspace UUID를 저장소나 일반 로그에 기록하지
않는다. dispatcher 활성화 시 빈 값이나 잘못된 UUID가 있으면 Agent 시작이 fail-closed로 거부된다.

## 3. 권위 증거 조립

1. `PostgresRuntimeEvaluationStore.assemble`로 고정된 `[since, until)` 구간과
   `research-read-v1` resource pool을 조회한다.
2. `runtime-promotion-v1`으로 최소 7일, 1,000 terminal attempts, 3개 load band, 필수 timestamp,
   Scheduler·prediction·retry coverage, MAE·꼬리지연·공정성 gate를 평가한다.
3. dataset fingerprint, artifact SHA-256과 전체 report를 immutable `SCHEDULER_POLICY` release로
   기록한다. 상태가 `APPROVED`가 아니면 이후 심사를 중단한다.
4. 같은 기간의 11C-3 operational snapshot과 장애 주입 증거로
   `ResearchPilotReadinessReport`를 만들고 `READY_FOR_LIMITED_PILOT`인지 확인한다.
5. provider outage, immutable image rollback, backup restore, 실제 네트워크 부하 테스트의 artifact
   reference와 실행 환경·시각·commit SHA를 수집한다.
6. 배포 commit SHA와 동일한 commit을 작성자가 아닌 reviewer가 검토하고 review reference와 시각을
   기록한다.

원문 objective, workload token, provider 응답 전문, secret과 chain-of-thought는 어떤 증거 artifact에도
포함하지 않는다.

## 4. 최종 승격 Gate

`ResearchPilotPromotionGate`는 다음을 모두 요구한다.

```yaml
runtime_release: APPROVED
recovery_readiness: READY_FOR_LIMITED_PILOT
terminal_attempts: ">= 1000"
observation_days: ">= 7"
workspace_count: "1..5"
resource_pool: research-read-v1
specialist_profile: research-read-v1
write_capable_tasks: 0
provider_outage_drill: passed
immutable_image_rollback: passed
backup_restore: passed
network_load_test: passed
image_digest: sha256-pinned
deployment_commit: 40-character SHA
independent_review: approved on the same commit
```

누락이나 불일치는 이유 코드와 함께 `HOLD`를 반환한다. 전부 통과한 경우에도 결과는
`ELIGIBLE_FOR_SEPARATE_RELEASE_REVIEW`이며 자동 배포나 Scheduler 재정렬 승인이 아니다.

## 5. 시작·중단 절차

시작 전 배포 변경에는 선택 workspace allowlist, 고정 image digest, 예상 관측 기간, 담당자와 rollback
창구를 포함한다. 독립 reviewer가 해당 변경을 승인한 뒤에만 dispatcher flag를 켠다. 관측 중에는
queue age, expired lease, `DISPATCHED`·`QUEUED` 불일치, terminal delivery, retry reason, provider circuit,
duplicate side effect와 workspace 침범을 확인한다.

11C-3 readiness 또는 본 gate가 `HOLD`·`ROLLBACK_REQUIRED`를 반환하면 새 유입을 중단하고
`phase-11-research-pilot-rollback.md`에 따라 `AGENT_FIFO_DISPATCHER_ENABLED=false`로 복귀한다.
queue, Task, Attempt와 outbox를 수동 삭제하지 않는다.

## 6. Phase 11 이후 경계

Scheduler 실제 재정렬 활성화와 기존 AgentRun fallback 제거는 이 심사에 포함되지 않는다. 각각
독립 PR, 운영 release evidence와 별도 승인이 필요하다. 현재 regression 평가와 gate 계산은 CPU로
충분하므로 RTX 5060 Ti 또는 외부 GPU 학습을 사용하지 않는다.
