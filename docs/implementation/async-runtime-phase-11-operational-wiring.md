# Async Runtime Phase 11 · 운영 Wiring과 Shadow Pilot 계획

> 상태: 11A, 11B-1, 11B-2a, 11B-2b, 11B-3, 11C-1, 11C-2 완료, 11C-3 준비 중
> 선행 조건: Phase 0~10 구현·자동 검증 완료
> 운영 경계: 기존 AgentRun fallback과 실제 `fifo-v1` 순서를 유지한다.

## 1. 검토 결론

Phase 11은 기존에 독립 검증한 Task Registry, Worker, Reliability, PostgreSQL FIFO Queue,
Scheduler Shadow를 실제 Agent 실행 경로에 단계적으로 연결하는 계획으로 타당하다. 다만 조립,
shadow 기록, 실제 worker dispatch를 한 단계로 취급하면 장애 지점과 rollback 범위가 불명확해진다.
따라서 11B와 11C를 더 작은 변경 단위로 나눈다.

다음 경계는 Phase 11 전체에서 고정한다.

- Routing만 실행 형태, 모델, 도구 프로필을 결정한다.
- Scheduler shadow의 defer, reject, scale, 재정렬 판단은 실제 순서를 변경하지 않는다.
- Spring은 공개 Task 상태와 권한의 권위 소유자이고 Python은 실행·checkpoint를 소유한다.
- prompt, credential, 원문 delegation token은 event에 저장하지 않는다.
- Redis, Kafka, 자동 secondary provider 전환은 도입하지 않는다.
- 운영 승격 전까지 기존 AgentRun fallback을 제거하지 않는다.

## 2. 단계별 계획

### 11A · 공통 Router composition

- FastAPI AgentRun과 LangGraph 진단 경로가 같은 operational gateway builder를 사용한다.
- `AGENT_ROUTE_SHADOW_ENABLED`가 켜져도 LLM evaluator가 항상 primary다.
- local shadow 초기화 실패는 구조화 경고만 남기고 primary route를 유지한다.

완료 기준:

- primary route와 shadow suggestion을 독립적으로 검증한다.
- shadow 초기화 실패 시 기존 policy gate와 fail-closed 동작이 변하지 않는다.

### 11B-1 · Async Runtime composition

- 단일 PostgreSQL 연결 관리자로 Registry, command inbox, event outbox, Reliability,
  Scheduler shadow, Evaluation, Operational Metrics 저장소를 조립한다.
- startup에서 migration 존재를 검증하는 저장소만 초기화한다.
- 기존 command API도 동일하게 조립된 inbox를 사용한다.

완료 기준:

- 런타임 저장소가 별도 연결 관리자를 만들지 않는다.
- memory AgentRun 구성은 PostgreSQL 런타임 서비스를 만들지 않는다.
- 기존 AgentRun 실행과 command API 회귀가 없다.

### 11B-2a · Task shadow identity와 멱등 등록

- Agent가 한 번 생성한 `taskId`를 Spring과 Python이 공유하고 Spring TaskGuard가 revision과
  authorization/budget revision을 권위 있게 확정한다.
- Research `DepartmentTask` 생성 경계에서 idempotent shadow registration을 수행한다.
- registration 이전에는 provider 작업을 시작하지 않는다.
- shadow 경로가 실패하면 명시적인 bypass 사유를 남기고 기존 AgentRun 경로로 복귀한다.

완료 기준:

- 동일 Task 등록 재전송은 같은 권위 revision을 반환한다.
- 같은 Task ID에 다른 계약을 보내면 fail-closed로 거부한다.
- Spring과 Python의 workspace/run/task/revision identity가 일치한다.

### 11B-2b · Attempt identity와 terminal observation

- Agent가 한 번 생성한 `attemptId`를 Spring과 Python Registry에 동일하게 등록한다.
- Task와 첫 Attempt는 Spring의 한 transaction에서 등록하고 exact retry에는 같은 Attempt를 반환한다.
- 같은 Attempt ID에 다른 task/revision/prediction 계약을 보내면 fail-closed로 거부한다.
- `AGENT_TASK_SHADOW_ENABLED` 기본값은 `false`이며 활성화된 PostgreSQL runtime에서만 등록한다.
- Spring이 확정한 identity와 authorization/budget revision을 검증한 뒤 Python Registry에 수렴시킨다.
- shadow 등록 실패는 오류 유형만 기록하고 기존 AgentRun 실행을 유지한다.
- 실행 시작과 성공·실패 종료를 같은 Attempt의 순번 이벤트로 outbox에 원자 기록한다.
- terminal observation coverage의 분모를 Python Registry에서 종료된 등록 Attempt로 고정하고,
  terminal event 기록률과 Spring 전달 ACK 비율을 별도로 측정한다.

완료 기준:

- Spring과 Python의 attempt ID와 attempt number가 일치한다.
- 중복 요청과 재시작이 Task 또는 Attempt를 복제하지 않는다.
- 완료·실패 Attempt의 terminal event 기록률이 100%다.
- Spring 전달 ACK 비율은 11B-3 replay 검증에서 100%를 충족해야 한다.

### 11B-3 · Spring projection과 ACK

- Python event outbox를 Spring projection 계약에 연결한다.
- ACK는 event ID만 반환하지 않고 workspace, run, task, attempt, revision, source, sequence identity를
  함께 반환하며 Python이 claim 원본과 전부 일치하는지 검증한다.
- ACK 유실·재전송·과거 revision event를 idempotent하게 처리한다.
- 최종 실패 event는 retry 판단을 기다리는 일반 실패와 구분해 현재 Task를 `FAILED`로 종료한다.

완료 기준:

- 늦은 event가 현재 revision projection을 변경하지 않는다.
- ACK 유실 후 replay에도 중복 공개 상태 전이가 없다.
- event payload에 secret 또는 원문 사용자 입력이 없다.

### 11C-1 · FIFO dispatcher pilot

- 사전 등록한 `research-read-v1`만 pilot 대상으로 허용한다.
- `PENDING → CLAIMED → DISPATCHED` lease 전이를 적용한다.
- 동일 resource pool의 경쟁 dispatcher 중 하나만 claim한다.
- dispatcher sink가 claim을 인수한 경우에만 `DISPATCHED`로 ACK하고, 거절·장애 시 lease를 유지해
  같은 queue row가 회수되게 한다.
- 실제 sink와 feature flag composition은 11C-2에서 연결하며, 11C-1은 기존 AgentRun 경로를 변경하지 않는다.

### 11C-2 · Research worker pilot

- 유효한 claim, 현재 revision, TaskGuard 검증을 모두 통과한 작업만 실행한다.
- cancel과 hard redirect 이후의 늦은 결과는 현재 revision에 병합하지 않는다.
- lease 만료 시 같은 queue row와 attempt를 회수한다.
- dispatcher는 기본 비활성이며 PostgreSQL Task shadow와 allowlist web research가 함께 활성화된 경우에만 조립한다.
- 원문 objective와 workload token을 queue·Task event에 추가 저장하지 않고 실행 중 메모리
  dispatch context에만 보관한 뒤 폐기한다.
- sink 인수 전 TaskGuard를 검증하고 worker 내부에서 다시 검증하며, verified result 기록 직전에
  PostgreSQL의 현재 Task·Attempt 상태를 다시 fencing한다.
- FIFO shadow worker가 활성화되면 기존 AgentRun은 primary fallback으로 계속 실행하고,
  RunCoordinator terminal observer 대신 worker가 shadow Task lifecycle을 소유한다.

### 11C-3 · 복구·관측 검증

- restart, checkpoint resume, cancel, redirect, ACK loss를 주입한다.
- queue age, lease expiry, retry budget, provider circuit, observation coverage를 측정한다.
- 실패 시 feature flag로 dispatcher를 끄고 기존 AgentRun fallback을 유지한다.

### 11D · 제한적 pilot과 승격 판단

- 제한된 workspace와 read-only Research 작업만 대상으로 한다.
- 최소 7일, 1,000 terminal attempts를 수집한다.
- 중복 side effect, workspace 침범, 만료 lease 미회수는 각각 0이어야 한다.
- provider 장애, immutable image rollback, backup restore, 실제 네트워크 부하 훈련을 통과한다.
- 독립 reviewer가 release evidence와 runbook을 승인해야 한다.

Scheduler 재정렬 활성화와 AgentRun fallback 제거는 Phase 11에 포함하지 않는다. 각각 별도의
`APPROVED SCHEDULER_POLICY` release와 제거 PR로 검토한다.

## 3. PR 순서

1. 11A + 11B-1: 공통 Router builder와 Runtime composition
2. 11B-2a: Task identity·멱등 shadow registration
3. 11B-2b: Attempt identity·terminal observation
4. 11B-3: Spring event projection·ACK·replay
5. 11C-1: PostgreSQL FIFO dispatcher pilot
6. 11C-2: Research worker와 command fencing
7. 11C-3: 장애 주입·운영 snapshot·rollback 검증
8. 11D: 제한적 pilot 증거 수집과 독립 승격 심사

각 PR은 기본 비활성 feature flag, 기존 fallback 보존, 독립 rollback 절차를 포함해야 다음
단계로 진행할 수 있다.
