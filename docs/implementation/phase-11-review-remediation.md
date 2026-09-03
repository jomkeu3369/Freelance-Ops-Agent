# Phase 11 운영 연결 검토 후속 수정

기준 커밋: `370b21b`. 수정 브랜치: `codex/phase-11-review-fixes`.

## 1. 이번 수정 범위

- 프로세스별 Research worker 슬롯을 첫 await 이전에 예약한다. 중복 attempt와 capacity 초과 요청은 외부 실행 없이 거절한다.
- lifespan에서 FIFO polling을 시작하고 종료 시 중단한다. 새 등록 요청이 없어도 살아 있는 프로세스의 대기 작업을 계속 소비한다.
- sink가 실행 컨텍스트와 guard를 확인한 뒤 scheduler ACK가 성공해야 worker를 시작한다. ACK 예외 시 슬롯을 반환하고 외부 호출을 하지 않는다.
- 종료 시 drain 대기를 제한하고 남은 작업을 취소한다. 취소에 협조하지 않는 provider는 별도 오류로 기록한다.
- Local Router shadow를 최대 1개만 실행하고 timeout 이후 primary 라우팅을 진행한다. thread-backed 추론을 강제 취소하거나 timeout마다 새 추론을 쌓지 않는다.
- Docker build argument `INSTALL_LOCAL_ROUTER=true`로 optional dependencies를 설치할 수 있다. entrypoint와 실행 명령은 `--no-sync`로 설치된 extras를 보존한다. 모델 다운로드·이미지 빌드는 이번 로컬 검증에 포함하지 않는다.
- Spring Task 등록은 Task ID에 대한 PostgreSQL transaction advisory lock 이후 조회한다. 아직 행이 없는 최초 등록도 직렬화한다. Attempt 등록도 같은 lock을 사용한다.
- 원래 revision의 등록 요청이 redirect 이후 현재 Task로 잘못 받아들여지지 않도록 revision을 비교한다.
- parent Task의 workspace/run을 검증하고 권한 순서를 정규화한다. 기존 저장 데이터의 권한 비교도 순서에 영향받지 않는다.
- Task control API의 계약 충돌은 409, 잘못된 identity는 400으로 반환하며 DB 상세 오류를 노출하지 않는다.

## 2. Pilot 시작 gate

기본값은 계속 비활성이다. 활성화에는 기존 PostgreSQL/Task shadow/Web Research/workspace allowlist 조건 외에 다음 설정이 필요하다.

- `AGENT_FIFO_DISPATCHER_READINESS_PATH`: 신뢰할 수 있는 배포 절차가 읽기 전용으로 mount한 JSON 증거 파일
- `AGENT_FIFO_DISPATCHER_READINESS_SHA256`: 해당 파일의 SHA-256
- `AGENT_FIFO_DISPATCHER_DEPLOYMENT_COMMIT_SHA`: 검토 대상 배포 커밋

Compose의 환경변수 전달과 local-router build argument를 연결했다. readiness path는 **컨테이너 안의 경로**이며, 운영 배포 override에서 실제 파일을 해당 경로로 읽기 전용 mount해야 한다. mount가 빠지면 startup은 실패한다. 저장소에 임의의 통과 증거 파일이나 기본 승인 manifest를 넣지 않는다.

파일 스키마는 `runtime.research_pilot_activation.PilotActivationManifest`가 정의한다. deployment commit, resource pool, workspace IDs, 생성/만료 시각, 기존 `ResearchPilotDrillEvidence`의 실제 장애 훈련 증거를 포함한다. 증거 유효기간은 최대 24시간이다.

startup에서 파일 hash, strict JSON 타입, 만료, 배포·workspace 범위를 확인하고 DB에서 읽은 최신 operational snapshot으로 readiness gate를 다시 평가한다. 실패하면 worker 시작 전에 startup을 중단한다. 환경변수는 기능 의도이며 검증 결과 자체가 아니다.

증거 파일과 hash를 수정할 수 있는 배포 관리자를 신뢰하는 운영 통제다. 암호학적 reviewer 서명 검증이나 자동적인 장애 훈련 수행을 대신하지 않는다. 테스트의 합성 통과 데이터로 운영 증거를 만들면 안 된다.

7일/1,000 terminal attempts를 요구하는 promotion gate는 제한 pilot 이후의 독립 승격 심사에 그대로 사용한다. 초기 pilot 시작에 promotion 통과를 요구하면 관측 데이터를 얻기 전에 데이터가 필요한 순환 조건이 된다.

## 3. 아직 완료되지 않은 차단 항목

이번 변경만으로 운영 pilot을 승인하지 않는다. 다음 항목의 구현·장애 훈련 전에는 dispatcher를 끈 상태로 유지한다.

1. **재시작 후 실행 컨텍스트 및 권한 복구**: 인메모리 broker는 여전히 restart 시 사라진다. AgentRun/checkpoint의 durable reference로 objective를 복원하고 Spring이 현재 권한·예산을 재검증해 새 위임 토큰을 발급하는 프로토콜이 필요하다. 원문/토큰을 queue나 event에 저장하지 않는다.
2. **ACK 직후 프로세스 종료 복구**: ACK 실패 전 외부 실행은 막았지만 ACK commit과 worker 시작은 원자적이지 않다. `DISPATCHED`/아직 `QUEUED`인 attempt 및 중단된 RUNNING attempt를 fencing하여 복구하는 경로가 필요하다.
3. **Primary와 Shadow의 예산 격리 및 비용 집계**: 두 실행은 여전히 같은 부모 예산을 독립적으로 사용할 수 있다. 별도 shadow 예약 예산/사용량 집계 또는 부모 예산 분할이 필요하다.
4. **다중 프로세스 및 event replay**: worker 슬롯은 프로세스별 제한이다. pool 전체의 분산 capacity, fresh run-scoped token을 이용한 재전송, 재시작 복구를 별도 통합 검증해야 한다.

## 4. 검증

새 회귀 테스트는 슬롯 예약 race, ACK 실패, bounded shutdown, 등록 없는 polling, shadow timeout/backlog, readiness hash/만료/scope/실패 증거, parent run/revision 충돌, HTTP 오류 매핑을 다룬다.

PostgreSQL 동시 최초 Task/Attempt 등록 테스트를 기존 Testcontainers 통합 테스트에 추가했다. Docker가 없으면 skip되므로 unit test 통과를 실제 DB 동시성 검증으로 보고하지 않는다.

이번 작업의 검증 결과:

- Python runtime/routing/API/integrations/config: 214 passed, 기존 FastAPI 의존성 deprecation warning 1개
- 변경 Python 파일 Ruff: 통과
- Python src Mypy: 81개 source 파일 통과
- Backend Task 테스트: 42 passed
- PostgreSQL 동시 등록 통합 테스트: Docker 미사용 환경으로 1 skipped, 실제 DB 검증 미완료
- Docker 이미지 build 및 실제 배포/장애 주입: 미실행

## 5. 후속 구현 · 이벤트 전달 범위 격리 (2026-09-03)

한 실행의 workload token으로 전체 outbox를 claim하던 경로를 수정했다. 이 작업은 위 보완 변경이
남아 있는 같은 작업 폴더에서 진행했으며, main 병합이나 배포 완료를 의미하지 않는다.

- `TaskAttemptEventStore.claim_for_delivery`와 `TaskEventPublisher.publish_once`에 workspace/run UUID를 필수로 받는다. 범위를 생략하는 전역 claim 경로는 제공하지 않는다.
- 메모리 및 PostgreSQL 저장소 모두 workspace와 run을 함께 필터링한다. batch limit 및 lease 회수 전에 범위를 제한하여 다른 실행의 이벤트에 lease나 재시도 횟수를 부여하지 않는다.
- publisher는 토큰이 비어 있으면 claim하지 않으며, 저장소가 범위를 벗어난 이벤트를 반환하면 HTTP 전송 전에 거부한다. 실제 토큰의 권한 검증은 계속 Spring이 담당한다.
- 기존 AgentRun shadow의 시작·종료 관측과 Research worker 모두 해당 실행의 workspace/run을 전달한다.
- 같은 workspace의 다른 run, 다른 workspace, 작은 batch, 만료 lease, ACK 재전송, 누락된 범위, 잘못된 저장소 결과를 회귀 테스트로 검증한다.

이번 재검증 결과:

- Python runtime/routing/API/integrations/config 및 terminal observation 통합 테스트 선택 실행: **225 passed, 1 skipped**. 기존 FastAPI deprecation warning 1개.
- 제외된 1개는 실제 PostgreSQL terminal observation 검증이다. `AGENT_INTEGRATION_DATABASE_URL`이 없어 실행하지 않았으며, SQL 생성 검사로 실제 DB 실행을 대체하지 않는다.
- 변경된 Python 파일 Ruff: 통과. `git diff --check`: 통과.
- Python src Mypy: 81개 source 파일 통과. Windows에서 `NUL` 캐시 경로 사용 시 검사기 내부 오류가 발생하여 별도 임시 캐시 경로로 재실행했다.
- Spring 코드는 이번 단위에서 변경하거나 재검증하지 않았다. 위의 Backend 결과는 이전 검증 기록이다.

### 남은 순서

1. durable reference 기반 실행 문맥 복원과 Spring의 현재 권한·예산 재검증 및 새 토큰 발급 계약을 연결한다.
2. ACK 후 중단된 DISPATCHED/QUEUED 및 RUNNING attempt를 안전하게 판별·복구한다. 중복 실행 방지를 검증한다.
3. primary/shadow 예산을 분리하고, pool 전체 실행 제한 및 새 run-scoped token을 사용하는 재전송을 연결한다.
4. 실제 PostgreSQL·프로세스 종료·재시작·토큰 만료 장애 테스트를 통과한 뒤 제한 pilot 시작을 별도로 검토한다.
5. pilot 이후 7일/1,000 terminal attempts 및 외부 장애 훈련·독립 검토 증거를 수집한다.

이번 범위 격리는 토큰 갱신, 자동 replay loop, 재시작 복구 또는 비용 격리를 구현한 것이 아니다.
따라서 pilot은 계속 비활성/HOLD로 유지한다.

## 6. 후속 구현 · 새 위임 및 문맥 복원 (2026-09-03)

5절 이후 추가한 첫 번째 복구 구현 단위다. 3절의 차단 항목 중 문맥 복원/새 토큰/범위 제한 replay를 보완했으며, ACK 후 소유권 복구·예산 격리·분산 capacity는 아직 구현하지 않았다.

### 연결

- Spring `ResearchRecoveryDispatcher`가 명시적인 workspace allowlist 안의 Research QUEUED/DISPATCHED/RUNNING Task를 한 번에 최대 20개씩 ID cursor로 순회한다. 첫 페이지에 실패한 작업이 남아도 다음 작업을 계속 검사한다.
- 저장 프로필을 `AgentTaskGuard`에 다시 전달하여 현재 membership, permissions, policy, model, 부모 예산 상한을 검증한다. 기존 authorization/budget revision과 달라지면 새로운 admission을 요구하며 토큰을 발급하지 않는다. 이것은 잔여 비용 원장의 검증이 아니며, 예산 분할은 별도 미완료 항목이다.
- 새 단기 토큰에 내부 복원 capability `agent.task.recover`를 추가한다. 일반 run 토큰으로는 복원 endpoint를 호출할 수 없다. 본문에는 task/attempt/revision 참조만 넣고 원문이나 토큰을 넣지 않는다.
- Agent의 `/internal/v1/agent-runs/{run_id}/research-recovery`가 서명·만료·run/workspace/project/initiated_by·프로필 revision을 검증하고 AgentRun 저장소에서 입력을 읽는다. 큐와 이벤트에는 원문/토큰을 추가 저장하지 않는다.
- 새 Task execution JSON에는 입력과 모델의 SHA-256 참조를 저장한다. 재개 등으로 입력이 바뀌었거나 기존 Task에 해시가 없으면 자동 복원을 거절한다. DB 컬럼 추가는 없다. 해시는 익명화 수단이 아니라 일치 검사용이며 private runtime 저장소에만 둔다.
- QUEUED attempt만 broker에 복원한다. 실행 중/종료된 attempt는 재실행하지 않고 해당 run의 이벤트만 재전송한다. 부모 run이 FAILED/CANCELLED여도 신규 staging 없이 replay만 허용한다.
- broker는 staging 및 dispatch load 시 토큰을 다시 검증한다. 만료된 context는 제거한다. 검증기 없는 broker 생성 경로는 없으며, `jurisdiction_code`도 복원한다.

### 운영 설정과 아직 남은 한계

`AGENT_RESEARCH_RECOVERY_ENABLED=false`가 기본값이다. Spring Compose 전달을 추가했고 `AGENT_FIFO_DISPATCHER_WORKSPACE_ALLOWLIST`를 두 서비스가 공유한다. 기본 재검증 간격은 `AGENT_RESEARCH_RECOVERY_DELAY_MS=10000`이다. **이 변경만으로 어느 flag도 활성화하지 않는다.** Agent 복원 서비스는 FIFO runtime 및 기존 readiness gate 안에서만 구성된다.

Spring의 재검증은 토큰 발급 시점의 스냅샷이다. 이미 발급한 토큰의 즉시 철회를 구현한 것은 아니며, dispatch에서는 JWT TTL/leeway 범위까지 유효성을 인정한다. 큐 규모·HTTP 지연에 따라 순회 주기가 토큰 TTL보다 길어지면 실행은 fail-closed로 지연될 수 있다. 이 특성과 다중 프로세스에서 특정 broker에만 문맥이 도착하는 문제는 실제 pilot 장애 훈련 대상이다.

복원 endpoint는 scheduler lease를 초기화하거나 DISPATCHED를 PENDING으로 변경하지 않는다. ACK 후 프로세스 중단 복구를 완료했다는 의미가 아니다. 권한 철회 후 이벤트 투영까지 필요한 운영 정리 경로, terminal projection 이후 늦은 이벤트 처리, 비용 집계 역시 별도 검토 대상이다.

### 검증 결과

- Python runtime/routing/API/integrations/config + terminal observation/Research dispatch 통합 테스트 선택 실행: 246 passed, 2 skipped. 새 복원 검증 21개 포함. 서명된 만료 토큰, scope 불일치, capability 누락, stale revision, 원문 변경, 기존 해시 누락, 시작/종료 attempt 비재실행, scoped replay를 확인했다.
- Spring Task 단위 테스트: 50 passed. 복원 dispatcher/HTTP client 8개 추가. membership 철회·권한 변경·예산 정책 거절·실패 후 다음 후보 진행·응답 identity를 확인했다.
- 실제 PostgreSQL 통합 검증은 환경 부재로 Python 2개, Spring 1개를 제외했다. Spring의 동시 등록 테스트에는 복원 후보 query의 workspace/cursor 검사도 추가했다. SQL/HQL 실행 결과를 확인한 것은 아니다.
- Python 전체 source Mypy: 84개 파일 통과. 기존 FastAPI deprecation warning은 남아 있다.
- 변경 Python 파일 Ruff와 `git diff --check`: 통과.
- 실제 서비스 재시작/강제 종료, Docker 이미지 빌드, 운영 호출 및 배포는 미실행이다.

완료 판정: **복원 계약의 구현·단위 검증 완료 / 전체 안정화·운영 승인 미완료 (HOLD)**.
