# 최초 실행 deadline으로 제한한 인증 검증 — 2026-10-14

## 승인 범위와 코드

사용자가 같은 사용자·프로젝트·실행의 기존 권한을 원래 작업 제한 시간 안에서 유지하는 **코드와 테스트**를 승인한 뒤 구현했다. 운영 적용, 다른 사용자/tenant/도구 권한 확장, 운영 credential 생성, production flag 변경은 수행하지 않았다.

- 전용 브랜치: `work/backend-agent-communication-20261014`
- 기준: `work/overnight-workflow-integration-20261014` / `1bf28eeaeb71ddabf422e1f08e171f4aff674027`
- `817038d`: QUEUED 생성 전 SSE 404를 빈 스트림으로 완료해 재연결 허용.
- `24fe9c3`: 기본 60초 만료 때 결과 보존·재시작·재실행 방지를 검증한 기존 실패 증거.
- `c9733fc`: 동일 실행의 고정 deadline과 최초 권한으로 제한한 실행 인증.
- `86433c0`: 접수된 resume를 이미 응답한 질문의 늦은 WAITING snapshot이 되돌리지 못하도록 projection 보완.

일반 `DelegationTokenIssuer.issue()`의 60초 수명은 유지한다. 이 토큰은 조회·reconciliation·취소 같은 control 요청에 사용한다. START/RESUME와 Spring internal tool에는 서명된 `execution_deadline`이 있는 실행 토큰이 필요하다. control 토큰으로 실행을 시작하거나 재개하면 403, internal tool에 사용하면 401이다.

Dispatcher는 Spring에 저장된 `run.createdAt + run.budget.maxDurationSeconds`를 최초 deadline으로 사용한다. BYOK는 기존 저장된 scope의 `validUntil`과 비교해 더 이른 시각을 사용한다. 실행 JWT의 exp는 이 deadline과 같고 초 단위 절삭은 종료를 앞당길 뿐 연장하지 않는다. retry와 resume는 최초 deadline을 그대로 사용한다. 일반 조회/control JWT가 실행 토큰을 교체하지 않는다.

최초 START command에 저장된 권한과 원래 initiator를 유지한다. 현재 command에 최초 권한 중 하나라도 없으면 실행 토큰을 발급하지 않는다. 새로 얻은 권한은 추가하지 않는다. public resume도 다른 initiator를 거부하며 이미 지난 최초 deadline에는 409 `AGENT_EXECUTION_DEADLINE_EXPIRED`로 응답한다.

Spring의 `DelegatedExecutionAccess`는 요청마다 현재 run/workspace/project/initiator, QUEUED/RUNNING 상태, 최초 permission snapshot, 현재 membership·권한, 프로젝트 삭제 상태, BYOK scope를 검증한다. 느린 DB 조회 뒤에도 deadline을 다시 확인한다. BYOK의 기존 run→scope 잠금 순서를 유지하며 이 transaction은 controller 호출 전에 종료된다.

양쪽 verifier는 실행 토큰의 exp와 execution deadline에 기존 JWT grace를 적용하지 않는다. 일반 control JWT의 기존 5초 clock skew 설정은 유지한다. execution claim의 최대 900초 형식 제한은 기존 RunBudget DTO 상한과 같으며 실제 허용 시간은 기존 admission·budget policy 및 저장된 run/BYOK 범위가 제한한다. 비용·quota·예산·시도 counter를 늘리거나 초기화하지 않았다.

Agent START/RESUME는 deadline 없는 토큰을 거부한다. resume는 저장된 최초 request의 workspace/project/initiator/권한도 검사한다. `RunCoordinator`의 worker timeout은 기존 budget, BYOK 남은 시간, 서명된 deadline까지의 남은 시간 중 최솟값이다.

## 실제 통신과 60초 초과·180초 경계

`AgentBoundedExecutionLiveTest`는 실제 시간을 기다리며 clock patch를 사용하지 않았다.

- Java `HttpAgentRunClient` → localhost Uvicorn/FastAPI verifier → 실제 `RunCoordinator`/`OperationalAgentExecutor` → 실제 `SpringToolClient` HTTP → Spring의 실제 verifier/filter/controller/`DelegatedExecutionAccess`.
- Agent 상태·결과는 독립 PostgreSQL **17.11 / pgvector 0.8.7**, `127.0.0.1:18114`에 저장.
- tool HTTP는 `18121`, 정상 완료 peer는 `18122`, timeout/cancel peer는 `18123`. 모두 loopback.
- Java HTTP server는 standalone MockMvc를 연결했다. Spring 업무 repository·permission reader·audit와 프로젝트 데이터는 fixture다. 전체 Spring application 프로세스와 실제 app-schema RBAC DB 검증은 별도 통합 세션이 수행한다.
- 모델 provider만 synthetic 응답/대기 대역이며 실제 외부 모델 HTTP는 **0회**. 실제 모델 품질·가격·청구 성공을 주장하지 않는다.
- 기존 `ConnectedWorkflowPostgresTest.TEST_KEYS` 메모리 fixture만 재사용. 키/토큰을 출력하지 않았다.

실제 증거:

| 경계 | 증거 |
| --- | --- |
| 60초 원본 JWT 만료 이후 완료 | run `64dfad24-f7e9-4df8-943a-02992b982a5e`. 원본 exp `01:35:45Z` 이후 `01:35:53.618249300Z`에 COMPLETED, 4개 부서 저장. 실제 tool HTTP 200 네 번. 만료 원본으로 GET하면 401. |
| 원래 180초 deadline | run `ba37eed7-20a8-44fb-814e-33865277bef9`. 고정 deadline `01:37:41Z`에서 FAILED / `RUN_TIMEOUT`, 첫 부서 결과 보존. 느린 모델 대역의 다음 tool은 실행되지 않았으며 기존 tool은 200 한 번. |
| 취소·완료 후 추가 tool 거부 | run `ac66f503-d7c3-4bc1-9b77-3e0a829b6607`를 실제 Agent HTTP로 취소한 뒤 CANCELLED 유지. Spring 취소/완료 projection에서 후속 tool 401. |
| deadline 이후 토큰 사용 | timeout peer의 Agent GET와 Spring tool 모두 401. 일반 새 조회용 60초 토큰으로 FAILED와 보존 결과는 조회 가능. |

증거는 `2026-10-14T01:37:42.497521900Z`에 기록했다. test peer 시작 기준 경과 시간은 176.73초이며, 고정 deadline은 test setup에서 먼저 정한 최초 접수 시각 + 180초다. 로컬 비밀값 없는 JSON은 `.tmp/bounded-jwt/evidence.json`에 있다.

기존 짧은 실행 토큰 실패 시험도 최신 코드에서 재검증했다. test-only execution claim과 60초 exp를 가진 토큰으로 run `5b5c2b78-81fe-461e-a57f-2774a0d66af2`의 실제 tool은 200→401, FAILED / `SPRING_TOOL_UNAUTHORIZED`, 1개 부서 보존. 프로세스 재시작 후 동일 결과, 같은 run start retry는 FAILED/no replay, resume 409였다. 이는 기본 만료 거부 정책이 남아 있다는 증거다.

## 실행 결과와 재현

| 검증 | 통과 | 실패 | 건너뜀 |
| --- | ---: | ---: | ---: |
| 최종 Java 통신·SSE·JWT/filter/controller·Gateway·dispatcher·projection·outbox·architecture 및 실제 단기 HTTP/기본 만료 실패 회귀 | 137 | 0 | 0 |
| 별도 실제 60초 초과/180초/cancel 실행 시험 | 1 | 0 | 0 |
| Agent API·delegation·executor·continuity·ReAct·Spring tools | 100 | 0 | 0 |
| resume projection·실제 interruption service·Gateway·execution guard·dispatcher 및 architecture 추가 회귀 | 103 | 0 | 0 |

별도 장시간 실행 시험은 security/dispatcher/Gateway/architecture와 함께 실행한 선택 검증 90개 중 1개다. 90개와 최종 137개에는 공통 테스트가 있으므로 합산하지 않는다. 최종 137개와 장시간 1개는 별도 테스트다. 전체 저장소 CI 결과가 아니다. Ruff 통과. 기존 Starlette TestClient deprecation 경고 1개가 남아 있다.

후속 103개도 137개와 공통 테스트가 있다. 재개 보완은 동일 interruption ID/workspace/run, 동일 질문 payload, 저장된 RESPONDED 상태를 확인한 뒤 현재 QUEUED/RUNNING만 유지한다. public view는 이전 질문을 내보내지 않는다. 새 PENDING/다른 interruption은 정상 WAITING으로 저장하며 질문 payload가 바뀐 동일 ID는 여전히 거부한다. WAITING에서 도구를 허용하지 않았다.

추가 보안 경계는 run/tenant/project/initiator 불일치, membership·agent.run·project.read 회수, 최초 snapshot 소멸/권한 추가, 프로젝트 삭제, WAITING/terminal 상태, 닫힌 BYOK scope, 잘못된 deadline/control 토큰, 원래 deadline을 지난 resume, 만료 발급의 outbox claim 해제·control reconciliation을 확인했다. DB 업무 상태 변경 경계의 이 검증은 repository fixture 기반 단위 시험이다.

```powershell
# backend 폴더, 기존 승인된 독립 DB 설정만 사용한다.
$env:AGENT_INTEGRATION_DATABASE_URL = '<existing approved isolated PostgreSQL URL>'
$env:AGENT_LIVE_TEST_PYTHON = (Resolve-Path ../agent/.venv/Scripts/python.exe).Path
$env:AGENT_LIVE_BOUNDED_TEST = 'true'
./gradlew.bat test --tests '*AgentBoundedExecutionLiveTest' --tests '*DelegatedExecutionAccessTest' --console=plain
```

환경 변수가 없는 일반 실행에서는 live 시험을 건너뛴다. 이 세션의 실제 실행은 opt-in/DB/Python을 설정했고 skip 0이다. 테스트가 소유한 HTTP peer만 종료하며 다른 세션의 DB/Docker를 건드리지 않는다. 로컬 증거·JUnit XML·runtime binary·fixture는 커밋하지 않는다.

## 통합과 남은 한계

통합 세션에 `c9733fc`를 전달했다. Spring과 Agent를 함께 새 코드로 재시작해야 하는 내부 인증 계약 변경이다. 구버전 Agent/Spring과 섞인 운영 배포 호환성을 주장하지 않는다. main 병합·운영 배포는 별도 승인 범위다.

별도 전체 흐름 세션은 `c9733fc`를 `2974ccc`로 통합해 실제 Next production build + 전체 Spring/FastAPI + PG17의 5개 여정(1~3개 의견·모바일·부분 실패·tenant)을 재검증하고 브라우저 API 5xx/page error 0을 보고했다. `86433c0` 이후 최종 전체 여정 재검증은 통합 담당에게 전달했다.

DB 마이그레이션은 **없다**. 기존 V19 START command 권한 snapshot과 run/BYOK 데이터를 재사용한다. 배포는 Spring과 Agent를 같은 인증 계약으로 전환해야 한다. 새 Agent는 구 Spring의 deadline 없는 START/RESUME 토큰을 403으로 거부하므로 버전 쌍 전환 중 새 실행 접수를 조율해야 한다. 롤백도 두 컴포넌트를 함께 원복하고 실행 중 작업은 먼저 drain/cancel한다. 저장 결과·예산·시도 counter를 삭제/리셋하거나 restart로 paid replay를 만들지 않는다. 이 세션은 직접 운영 배포를 하지 않았다.

### 구버전 토큰 호환성 검토

**제한 없는 legacy START/RESUME fallback은 추가하지 않았다.** 구 Spring의 정상 dispatch JWT와 현재 Spring의 조회/control JWT는 동일 issuer/key/audience, run/workspace/project/initiator/permission claims, 60초 exp 형식을 사용한다. 검증된 토큰 내용만으로 두 용도를 구분할 수 없다. unsigned header나 배포 버전 추정으로 허용하면 새 control 토큰도 실행에 사용되는 우회가 생긴다. 과거 BYOK의 `duration + 30` 토큰도 원래 실행 scope deadline을 담지 않는다.

token exp까지만 legacy 실행을 허용하는 방법 역시 기존 control-only 계약을 바꾼다. 특히 resume마다 새 60초 토큰을 발급하는 구 경로에는 최초 서명 deadline이 없으며, 예산을 다시 시작하는 old Agent와 섞이면 동일 실행의 원래 제한 시간을 보장할 수 없다. Spring에 저장된 run/BYOK deadline과 최초 권한을 조회하는 새 경로를 모두 거쳐야 한다. 현재 구현은 해당 경로에서 발급한 signed execution claim을 요구한다.

만약 기존 dispatch JWT의 jti와 원래 scope/deadline을 신뢰할 수 있는 별도 admission 기록으로 이미 식별할 수 있다면 그 기록에 한한 이전은 설계할 수 있다. 현재 issuer/outbox에는 그러한 token-purpose/jti 기록이 없으므로 이 검토에서 가정하지 않는다. 운영 토큰을 읽어 목록을 만들거나, 기존 실행의 토큰을 새로 발급해 교체하거나, JWT expiry/grace를 완화하지 않았다.

| 버전/토큰 경계 | 현재 동작·증거 |
| --- | --- |
| 새 Spring + 새 Agent, bounded execution token | 실제 60초 초과 완료·180초 cutoff 통과. 같은 run/workspace/project/initiator 및 최초/현재 권한으로 제한. |
| 구 Spring JWT / 현재 control JWT, deadline 없음 | Agent START/RESUME 403 `EXECUTION_AUTHORITY_REQUIRED`; Spring tool 401. API parameterized regression, 실제 HTTP start rejection과 filter regression 통과. |
| deadline 없는 token의 정상 GET/control | 기존 60초 검증을 유지. 실제 deadline 이후 새 조회 token으로 FAILED/결과 조회, 실제 cancel 성공. 실행 권한으로 승격하지 않음. |
| 만료 원본 token 재사용 | 실제 exp+8초 이후 Agent GET 401; 짧은 실행 capability의 Spring tool 200→401과 실패 보존 재검증. |
| 새 실행 token의 다른 run / tenant / owner | 실제 다른 run GET 403, Spring guard 단위 경계 및 API context 검증에서 거부. |
| 새 실행 token의 deadline/exp | 양 verifier는 실행 토큰에 strict cutoff 적용. 실제 180초 이후 Agent/Spring 401, 기존 5초 grace 안의 deadline도 verifier regression에서 거부. |
| 새 Agent + 구 Spring | 구 START/RESUME는 403이므로 신규 실행 전환 중 혼합 운영을 지원하지 않음. |
| 구 Agent + 새 Spring | 구 Agent는 signed deadline을 worker cutoff로 사용하지 않아 동일 최초 deadline 보장을 주장할 수 없음. |

따라서 신규 실행은 같은 버전의 Spring/Agent 쌍으로 전환하고, 기존 실행은 원래 권한/토큰의 범위에서 drain하거나 명시적으로 cancel한 뒤 전환한다. 배포 후보를 먼저 격리 검증하고 전환 중 새 실행 접수를 조율한다. 롤백에도 같은 제약이 적용된다. 안전한 호환성의 증거 없이 legacy 실행을 조용히 허용하지 않는다.

기존 task shadow의 terminal event 게시가 원래 execution JWT를 사용하므로 deadline 만료 뒤 게시가 거부될 수 있다. 동일 control-plane HTTP clients의 `X-Run-Id` 누락도 읽기 전용 검토에서 확인됐다. 이 경로의 등록/heartbeat 권한을 새로 부여하거나 토큰을 연장하지 않았다. Agent의 실제 PG terminal 상태와 보존 결과는 위 시험으로 확인했으며, 별도 task 관측 전달 성공은 이 변경의 증거에 포함하지 않는다.

운영 readiness는 앞선 한 번의 저빈도 공개 읽기에서 200/UP였을 뿐, 작업 브랜치의 인증 기능 검증이 아니다. 새 승인 차단은 없다. 이후 부모가 운영 반영 승인을 전달했으며 PR/CI와 배포 후보 조율은 전체 여정 세션의 담당이다. 그 세션이 전달한 draft PR #74 성공·CI 진행 상태는 자체 도구 증거로 재확인하지 않았고 이 세션의 배포 성공으로 주장하지 않는다.
