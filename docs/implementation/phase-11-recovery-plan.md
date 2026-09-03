# Phase 11 안정화 실행 계획

기준: `codex/phase-11-review-fixes`의 기존 미커밋 수정과 이벤트 workspace/run 격리를 보존한다.

## 순서 및 완료 조건

- [x] 1. 재위임 및 문맥 복원 구현/단위 검증: Spring이 현재 회원 권한·실행 프로필·부모 예산을 재검증한 후 run-scoped 새 토큰으로 Agent에 복원을 요청한다. Agent는 기존 AgentRun 저장소에서 원문을 읽는다. 토큰은 DB에 저장하지 않는다. 만료·범위 불일치 시 실행하지 않는다. 실제 DB/재시작 검증은 4번에 남아 있다.
- [x] 2. 실행 소유권 및 복구 구현/단위 검증: ACK 후에도 claim identity/lease를 보존한다. 실제 시작과 결과 저장은 DB에서 소유권을 검증한다. 만료된 시작 전 작업은 재대기시키고, 외부 실행이 시작된 작업은 같은 attempt로 재실행하지 않고 WORKER_LOST 실패로 정리한다. 실제 장애 검증은 4번에 남아 있다.
- [x] 3. 예산 및 전체 동시성 구현: shadow에 부모 예산 일부를 예약하고 primary에는 나머지만 부여한다. DB의 resource pool 잠금으로 다중 프로세스의 유효 소유권 수를 제한한다. 실제 DB 경합 검증은 4번에 남아 있다.
- [ ] 4. 검증: 단위/타입/스타일 검사, PostgreSQL 동시성·종료 경계 검사, 토큰 만료·권한 철회 검사. 환경 때문에 실행하지 못한 테스트는 명시적으로 제외 기록한다.
- [ ] 5. 인계: 변경사항 검토, 생성 캐시 정리, 커밋/푸시/PR 생성. 승인 권한과 작성자 제한을 확인하며 제한을 우회하지 않는다. 병합·배포·실제 pilot 활성화는 하지 않는다.

## 안전한 복구의 의미

외부 Provider는 응답을 잃더라도 비용이 발생할 수 있다. RUNNING attempt를 그대로 재시도하면 중복 비용을 입증 없이 발생시키므로, 재시작 복구의 기본값은 자동 재실행이 아니라 소유권 fencing과 명시적 종료다. 새로운 재시도는 별도 attempt 및 잔여 예산 승인이 있어야 한다.

진짜 7일/1,000건 운영 관측과 외부 장애 훈련은 로컬 합성 테스트로 대체하지 않는다.

## 2026-09-03 진행 기록

1번을 첫 구현 단위로 완료했다. 기존 검토 수정사항과 함께 커밋/푸시했다. Draft PR 생성을 요청했지만 GitHub 연결이 `403 Resource not accessible by integration`을 반환하여 PR 생성과 승인은 수행하지 못했다. 2·3번과 실제 통합 검증 전에는 전체 안정화 완료나 운영 승인으로 간주하지 않는다. 다음 구현 대상은 ACK 소유권 유지와 시작/종료의 원자적 fencing이다.

상세 동작, 제한 및 검증 기록은 `phase-11-review-remediation.md`의 6절에 기록한다.

## 잔여 작업 실행 상세

1. 스키마: 실행 중 claim을 유지하는 제약과 pool capacity/부모 예산 예약 원장을 추가한다. 구버전의 살아 있는 claim이 있으면 마이그레이션을 중단하여 rolling upgrade 중 이중 실행을 막는다.
2. 소유권: task → attempt → scheduler entry 잠금 순서를 통일한다. 시작/종료/event 기록을 한 트랜잭션으로 묶고, 만료되거나 교체된 소유자의 결과는 거절한다.
3. 복구: claim만 만료된 QUEUED는 재대기, 실행이 시작된 RUNNING은 WORKER_LOST로 종료한다. polling 중 복구하며, fresh token의 scoped replay로 Spring 투영을 갱신한다.
4. 동시성: resource pool advisory lock 아래 DB capacity와 활성 lease 수를 확인한다. 프로세스가 실제 보유한 유효 context의 attempt만 claim하여 다중 broker 간 잘못된 claim을 방지한다.
5. 예산: opted-in pilot run의 primary/shadow 예산을 실행 전에 원자적으로 예약한다. 결과가 불명확하면 예약을 환급하지 않는다. pilot은 단일 primary 실행만 허용하며 동일 run의 재개/재실행은 새 예산 admission 전까지 fail-closed다. 다른 workspace의 기존 실행은 유지한다.
6. 검증: DB 없는 단위 검증과 실제 PostgreSQL 장애/경합 테스트를 구분한다. 가능한 격리된 로컬 DB를 확인하되 운영 DB에는 테스트/마이그레이션을 실행하지 않는다.
7. 기록·인계: 실제 결과를 갱신하고 생성 캐시를 정리한다. 브랜치 push 및 PR 쓰기 권한을 재확인하되 권한 제한을 우회하지 않는다. 운영 활성화·병합은 하지 않는다.

### 후속 상태

2·3번 구현과 report-only 이벤트 재전송까지 반영했다. 최신 동작과 검증 결과는 `phase-11-review-remediation.md` 7절이 이전 시점의 미완료 설명을 대체한다. 4번은 실제 DB/프로세스 장애 훈련이 필요하므로 미완료이며, 5번은 PR 권한 확인까지 완료되어야 닫는다. 전체 상태는 HOLD다.
