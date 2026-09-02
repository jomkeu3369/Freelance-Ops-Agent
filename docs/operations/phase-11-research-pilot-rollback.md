# Phase 11 Research FIFO Pilot · 장애 주입과 Rollback Runbook

## 1. 목적

이 runbook은 `research-read-v1` FIFO shadow pilot의 11C-3 장애 주입, 운영 snapshot 판정과
rollback 절차를 고정한다. 기존 AgentRun은 pilot 전체에서 primary fallback으로 유지하며,
readiness report가 `ROLLBACK_REQUIRED`이면 11D 제한 pilot을 시작하거나 계속하지 않는다.

## 2. 장애 주입 증거

| 경계 | 주입 조건 | 통과 조건 | 자동 검증 |
|---|---|---|---|
| restart·lease | claim 후 ACK 전에 dispatcher 인스턴스 교체 | 같은 queue row·attempt가 lease 만료 후 한 번만 회수됨 | `test_scheduler_shadow_postgres.py` |
| checkpoint resume | checkpointer와 DB 연결 인스턴스 교체 | 같은 run·thread가 중복 side effect 없이 재개됨 | `test_postgres_restart_resume.py` |
| cancel·redirect | 실행 중 현재 revision에 명령 적용 | 이전 attempt가 terminal fence되고 늦은 결과가 거부됨 | `test_task_commands_postgres.py`, `test_research_specialist.py` |
| ACK loss·replay | 같은 Task event를 재전송 | 같은 fenced ACK를 반환하고 projection을 중복 변경하지 않음 | `AgentTaskEventIngestionServiceTest` |
| retry budget | 독립·결정론·provider 장애 신호 주입 | workspace·global token bucket과 retry reason이 기록됨 | `test_task_reliability_postgres.py` |
| provider circuit | 상관 provider 장애와 probe 주입 | circuit latch와 bounded recovery가 정책대로 동작함 | `test_reliability.py`, `test_ai_gateway.py` |
| rollback | dispatcher flag를 비활성화한 composition 시작 | FIFO worker가 조립되지 않고 기존 AgentRun 경로가 유지됨 | `test_config.py`, `test_executor.py` |

실제 운영 증거에는 각 테스트의 commit SHA, CI run URL, 실행 시각, 환경과 결과를 함께 기록한다.
조건부 제외된 PostgreSQL 테스트는 증거로 인정하지 않는다.

## 3. Fail-closed 판정

`ResearchPilotReadinessGate`는 운영 snapshot과 장애 주입 증거를 결합한다. 다음 중 하나라도
발생하면 `ROLLBACK_REQUIRED`이다.

- 실패한 restart, checkpoint, cancel, redirect, ACK loss, retry, circuit 또는 rollback drill
- 남아 있는 expired lease
- `DISPATCHED` queue row에 대응하는 Attempt가 아직 `QUEUED`인 상태
- 정책 시간을 넘긴 ready queue age
- duplicate side effect 또는 cross-workspace violation 1건 이상
- Scheduler observation coverage 100% 미만
- terminal delivery coverage 100% 미만
- retry reason coverage 99% 미만
- 기존 AgentRun fallback 미보존

OPEN provider circuit과 retry queue 자체는 장애 완충이 정상 동작한 결과일 수 있으므로 건수만으로
rollback하지 않는다. 대신 circuit·retry drill 실패와 coverage 누락을 판정한다.

## 4. Rollback 절차

1. 새 Research FIFO pilot 유입을 중단한다.
2. Agent 배포 설정의 `AGENT_FIFO_DISPATCHER_ENABLED`를 `false`로 변경한다.
   `AGENT_FIFO_DISPATCHER_WORKSPACE_ALLOWLIST`는 incident 비교를 위해 secret/config history에
   보존하되 새 dispatcher 실행에는 사용하지 않는다.
3. 정상 종료 유예 시간 동안 현재 in-memory Research worker가 끝나는 것을 기다린 뒤 Agent replica를
   순차 재시작한다.
4. `AGENT_TASK_SHADOW_ENABLED`와 기존 AgentRun 경로는 유지한다. Task shadow까지 장애 원인인 경우에만
   별도 승인 후 `AGENT_TASK_SHADOW_ENABLED=false`로 내린다.
5. queue row, Task, Attempt 또는 outbox를 수동 삭제하거나 임의 SQL로 상태 변경하지 않는다.
6. resource pool snapshot에서 새 claim이 증가하지 않는지, AgentRun 성공률이 fallback 기준으로
   회복되는지 확인한다.
7. expired lease 또는 `DISPATCHED`·`QUEUED` 불일치가 남으면 incident를 열고 run·workspace·task·attempt
   식별자와 snapshot만 보존한다. 원문 objective, token과 provider 응답은 incident 기록에 남기지 않는다.

## 5. 재활성화 조건

원인 수정 PR과 같은 commit에서 전체 장애 주입을 다시 실행하고 readiness report가
`READY_FOR_LIMITED_PILOT`이어야 한다. 최소 7일·1,000 terminal attempts와 독립 reviewer 승인은
11D의 별도 승격 조건이며 이 runbook 통과만으로 Scheduler 정책 또는 fallback 제거를 승인하지 않는다.
