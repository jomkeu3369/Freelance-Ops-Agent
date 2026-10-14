# Backend–Agent 로컬 통신 검증 — 2026-10-14

## 작업 기준과 변경

- 기준 브랜치: `work/overnight-workflow-integration-20261014`
- 기준 원격 SHA: `1bf28eeaeb71ddabf422e1f08e171f4aff674027` (최종 원격 조회에서도 동일)
- 전용 브랜치: `work/backend-agent-communication-20261014`
- 사용자 checkout을 수정하지 않은 별도 clone에서 작업했으며 저장소의 `AGENTS.md`는 없었다.
- 운영 병합·배포·강제 푸시·비용 활성화·운영 자격증명 생성은 수행하지 않았다.

| 커밋 | 변경 |
| --- | --- |
| `954899c` | SSE 응답 헤더 대기를 기존 HTTP read timeout으로 제한하고 공개 스트림의 수명을 기본 30초로 제한. timeout/completion에서 upstream을 닫아 재연결 가능하게 함. |
| `776a510` | run/attachment/pet adapter가 공유 `RestClient.Builder`를 clone하고 HTTP/1.1을 명시. 생성 순서에 따른 request factory/timeout 오염과 Uvicorn의 h2c 요청 오류 방지. 실제 Java↔Python HTTP 회귀 추가. |
| `17cf5f8` | outbox 전달 전 Agent404를 받은 `get`/`latest`는 Spring에 저장된 QUEUED receipt를 반환. 결과·사용량·Agent 버전은 만들어 내지 않음. 권한 오류, 서버 오류, 이미 접수된 다른 상태의 404, 프로젝트 삭제 경계는 기존 의미 유지. |
| `f7c7ac1` | 운영 실행기가 발행하는 공개 `knowledge.retrieved` 이벤트를 SSE relay에 허용. 다음 completion까지 정상 전달하는 회귀 추가. |
| `817038d` | 접수 직후 Agent가 아직 만들지 않은 SSE의 404를 권한 확인·로컬 재조회 QUEUED에 한해 빈 스트림으로 완료. 이벤트/cursor를 만들지 않고 재연결을 허용. 다른 상태와 오류는 유지. |

`AGENT_EVENT_STREAM_TIMEOUT_MS`는 기본 30000이며 양수만 허용한다. run JWT의 수명이나 권한 목록은 변경하지 않았다.

## 실행 환경과 실제 통신

- Windows Java 21, 저장소 Gradle wrapper 9.6.1, Python 3.12 및 `uv sync --locked`.
- Uvicorn peer: `127.0.0.1:18110`; HTTP transport fault peer: `127.0.0.1:18119`.
- 장시간 만료 시험: 실제 tool HTTP `127.0.0.1:18111`, Uvicorn `127.0.0.1:18115`, 동일 독립 PG17 `127.0.0.1:18114`.
- 최종 독립 DB: PostgreSQL **17.11**, pgvector **0.8.7**, `127.0.0.1:18114`.
- 보조 독립 DB: PostgreSQL **18.6**, pgvector **0.8.1**, `127.0.0.1:18113`.
- localhost SCRAM 인증과 기존 공식 테스트 기본값만 사용. 운영 키를 가져오거나 출력하지 않았다.
- 공식 [PGDG APT 패키지](https://wiki.postgresql.org/wiki/Apt)를 작업 폴더에만 추출하고 패키지 SHA256을 공식 metadata와 비교했다. 시스템 패키지나 서비스를 설치하지 않았다.
- 두 DB는 다른 세션의 DB와 별도 데이터 디렉터리이며 각 서버에 loopback을 명시했다. 공유 Docker 리소스를 중지·삭제하지 않았다.
- 저장소 CI의 PostgreSQL 주요 버전 17로 최종 회귀했다. 동일 Docker 이미지와 전체 운영 구성의 검증은 아니다. 보조 PG18 증거는 별도로 남겼다.

`AgentHttpLiveContractTest`는 실제 `HttpAgentRunClient` → Uvicorn의 기존 FastAPI app/router/JWT verifier → `RunCoordinator` → PostgreSQL store를 통과한다. 실행기와 서명은 저장소의 `InterruptThenCompleteExecutor` 및 `_client_and_token` 테스트 fixture다. 실제 `OperationalAgentExecutor`의 모델 품질을 이 테스트로 주장하지 않는다. 실제 전체 사용자 여정의 provider-adapter 대역 검증은 별도 세션의 담당이다.

실제 HTTP에서 다음을 확인했다.

- start 202와 HITL 대기 상태, 동일 start 재전송 시 실행 중복 없음.
- 첫 스트림의 `run.accepted`/`run.started`/`clarification.requested`.
- `Last-Event-ID: 3` 이후 대기 스트림에는 재전송 이벤트 없음.
- resume 202 후 COMPLETED, 동일 resume 재전송은 409로 거부.
- 재개 후 `Last-Event-ID: 3`에서는 4·5·6번 이벤트만 수신.
- 다른 run ID를 같은 JWT로 조회하면 403, 잘못된 토큰은 401.
- header를 보내지 않는 실제 socket peer는 유한한 시간 안에 timeout; header 수신 뒤 body는 별도 스트림 수명으로 처리.

최종 실제 DB 증거(2026-10-14 00:48:45 UTC): run `4ce9ac94-cd36-42d0-8635-251086aee9ea`, 상태 `COMPLETED`. 이벤트는 순서대로 `1 run.accepted`, `2 run.started`, `3 clarification.requested`, `4 clarification.responded`, `5 run.started`, `6 run.completed`였다. 중복 start/resume를 검사한 뒤에도 이 6개만 존재했다. 비밀값을 제외한 JSON은 로컬 `.tmp/validation/live-http-evidence.json`에 남겼다.

초기 실제 통신에서 발견한 h2c 본문 누락과 다른 세션이 전달한 QUEUED 조회/지식 조회 SSE 종료 문제는 수정 후 재검증했다. 벡터 확장이 없는 보조 native PG17의 검증은 준비도 검사에서 거부됐고, 확장을 우회하지 않은 PG17/pgvector 환경으로 교체해 통과했다. 수동 peer의 단기 fixture 만료는 JUnit이 테스트 직전에 peer를 시작·종료하도록 바꾸어 해결했다.

## 테스트 결과

| 최종 선택 검증 | 통과 | 실패 | 건너뜀 |
| --- | ---: | ---: | ---: |
| Java 통신·JWT·SSE·Gateway·projection·outbox·reconciliation 및 architecture 최종 회귀 | 100 | 0 | 0 |
| 실제 wall-clock JWT 만료·결과 보존·프로세스 재시작·재시도 경계 | 1 | 0 | 0 |
| Agent API·continuity·Spring tools·task events·delegation unit | 46 | 0 | 0 |
| Agent executor·continuity·ReAct·Spring tools 추가 회귀 | 73 | 0 | 0 |
| PostgreSQL17 restart/resume·continuity·completion funding | 7 | 0 | 0 |
| PostgreSQL17 task command inbox·terminal observation·BYOK security | 3 | 0 | 0 |
| PostgreSQL18 restart/resume·continuity·completion funding | 7 | 0 | 0 |

Java 최종 100개 중 1개가 위 실제 Java↔Uvicorn↔DB 계약 테스트이며, 8개는 Gradle에 의해 함께 실행되는 architecture 테스트다. 만료 시험은 별도로 한 번 통과한 결과이며 이 100개와 중복되지 않는다. 만료 시험과 Gateway/transport/architecture를 같이 실행한 선택 검증 57개도 모두 통과했다. Agent 46개와 추가 73개에는 공통 테스트가 있으므로 합산하지 않는다. 전체 저장소 CI를 실행했다는 의미가 아니다. Agent 변경 파일의 Ruff check/format도 통과했다. Starlette TestClient deprecation 경고 1개는 남아 있다.

최종 suite와 각 테스트 수는 로컬 `.tmp/validation/` JUnit XML에 남겼다. 이 디렉터리의 테스트 fixture/JWT, DB 데이터, 다운로드한 binary는 커밋하지 않는다.

## 재현

독립 pgvector DB에 `agent_runtime` schema를 준비한 뒤 저장소 Alembic을 적용한다. 아래 `AGENT_INTEGRATION_DATABASE_URL`에는 **기존 승인된 테스트 DB 구성**을 사용한다.

```powershell
# agent 폴더
$env:AGENT_DATABASE_URL = $env:AGENT_INTEGRATION_DATABASE_URL
uv run --locked alembic upgrade head
```

Windows의 psycopg async는 selector loop가 필요하다. 이 세션의 DB tests는 기존 pytest invocation에 `WindowsSelectorEventLoopPolicy`를 지정했으며 서비스 production 코드를 바꾸지 않았다. 새 peer helper는 selector loop를 명시한다.

```powershell
# backend 폴더. 테스트가 peer를 시작하고 종료한다.
$env:AGENT_LIVE_TEST_PYTHON = (Resolve-Path ../agent/.venv/Scripts/python.exe).Path
$env:AGENT_LIVE_TEST_BASE_URL = 'http://127.0.0.1:18110'
$env:AGENT_LIVE_TEST_FIXTURE = [IO.Path]::GetFullPath('../.tmp/live-http-fixture.json')
$env:AGENT_TEST_HTTP_PORT = '18119'
./gradlew.bat test --tests '*AgentHttpLiveContractTest' --tests '*HttpAgentRunTransportTest' --console=plain
```

test peer는 localhost HTTP만 허용하며 필요 임시 디렉터리를 생성한다. 테스트 토큰은 출력하지 않는다. `AGENT_LIVE_TEST_FIXTURE`를 설정하지 않은 일반 테스트 실행에서는 opt-in live test가 건너뛰어지므로 결과를 확인해야 한다. 이 세션의 최종 실행은 실제 DB URL과 opt-in 변수를 설정했고 건너뜀은 0이었다.

## 60초 JWT와 180초 실행 예산의 실제 실패 경계

`AgentJwtExpiryLiveTest`와 `agent/tests/support/expired_jwt_http_peer.py`는 시계를 바꾸지 않고 실제 시간을 기다렸다. Java의 기존 `ConnectedWorkflowPostgresTest.TEST_KEYS` 메모리 fixture를 재사용했으며 운영 키를 읽거나 새로운 운영 인증 정보를 만들지 않았다. 실행기의 원래 JWT는 기본 60초, 예산은 180초다. 기존 만료 허용 오차 5초도 유지했다.

실제 경로는 `HttpAgentRunClient` → Uvicorn/FastAPI JWT verifier → `RunCoordinator`/`OperationalAgentExecutor` → 실제 `SpringToolClient` HTTP → Java의 실제 `DelegationTokenFilter`/`InternalToolController`다. Java tool endpoint는 localhost HTTP server에 standalone MockMvc를 연결했다. 프로젝트 업무 데이터와 audit service, 모델 provider 응답은 synthetic 대역이며 전체 Spring application 프로세스 검증은 아니다. Agent 상태와 결과는 실제 PG17에 저장했다. 외부 모델 HTTP는 0회다.

실행 `b2282210-863b-4562-b522-e556aef79d5a`의 증거:

- 첫 도구 호출 `2026-10-14T01:04:30.993648400Z`: HTTP 200. 첫 부서 결과 저장 후 RUNNING 확인.
- 원래 JWT 만료 `2026-10-14T01:05:22Z` 이후 다음 도구 호출 `01:05:30.062519200Z`: HTTP 401. 두 호출 모두 동일한 원래 실행 토큰을 사용했다.
- 실행은 `FAILED / SPRING_TOOL_UNAUTHORIZED`로 끝났고 저장된 첫 부서 결과와 사용량(대역 모델 응답 3회)을 보존했다. 테스트의 peer 시작 기준 경과 시간은 65.05초다.
- Agent 프로세스를 종료·재시작한 뒤에도 같은 실패와 결과가 조회됐다. 새 조회 전용 JWT는 실패 조회에만 사용했고 worker 실행 토큰을 교체하지 않았다.
- 같은 run ID로 명시적 start 재전송은 기존 FAILED를 반환하며 실행을 반복하지 않았다. FAILED 실행의 resume은 409다. 사용량과 `run.started` 수는 증가하지 않았다.
- SSE에는 `department.saved`와 `run.failed`/안정된 오류 코드가 남고 `run.completed`는 없다. 만료된 원래 JWT로 조회하면 401이다.

비밀값을 제외한 증거는 로컬 `.tmp/long-jwt/evidence.json`, JUnit 결과는 `.tmp/validation/java-long-jwt-57/test-results/`에 있다. 이 시험은 180초 장시간 실행 성공을 입증하지 않는다. 만료 시 저장 결과·명확한 오류·재실행 방지를 기존 정책에서 확인한 실패 시험이다. 해당 동작은 이미 구현돼 있어 추가 권한 정책이나 Agent production 변경이 필요하지 않았다.

```powershell
# backend 폴더, 기존 승인된 격리 DB URL과 Python runtime 설정을 유지한다.
$env:AGENT_LIVE_LONG_TEST = 'true'
./gradlew.bat test --tests '*AgentJwtExpiryLiveTest' --console=plain
```

이 opt-in 시험은 18111/18115 포트를 사용하며 테스트가 소유한 HTTP peer만 종료한다. 일반 테스트에서는 환경 변수가 없으면 건너뛰므로 CI에서 실행하려면 Python/pgvector DB와 opt-in 설정이 필요하다.

## 권한 정책과 운영 확인의 한계

- 짧은 계약 fixture는 **60초 JWT / 180초 budget**으로 60초 이내 완료됐다. 별도 장시간 실패 시험은 위와 같이 실제 만료 이후의 401·FAILED·결과 보존을 확인했다.
- 일반 실행의 `DelegationTokenIssuer.issue()` 60초와 전체 실행 예산 180초의 정책 및 개인 키 실행의 기존 별도 수명 계산을 유지했다. 수명 연장·자동 갱신·만료 토큰 허용은 구현하지 않았다. 장시간 provider 성공은 검증하지 않았다.
- 만료 뒤 같은 실행을 계속하려면 **동일 run/workspace/project/user/권한/예산으로 제한한 실행 토큰 갱신 정책**의 별도 승인이 필요하다. 대안은 사용자가 새 실행을 명시적으로 요청하고 기존 admission을 다시 통과시키는 방식이다. 기존 FAILED run의 idempotency 의미를 바꾸거나 저장 결과를 자동으로 새 실행에 연결하지 않는다.
- 갱신을 승인할 경우 시험해야 할 경계는 회원/권한/키 철회, 종료·실패 run의 갱신 거부, 예산·사용량·불확실한 시도 카운터 유지, 거부 이후 모델/도구 재실행 없음, 원래 만료 JWT의 401 유지, timeout·중복 갱신의 실행 중복 방지다. 이 문서는 설계 범위를 기록하며 정책 승인을 대신하지 않는다.
- 모든 provider 응답은 테스트 대역이며 실제 외부 모델 호출, provider 품질·가격·청구 검증은 하지 않았다.
- 운영 공개 `GET https://api.freelance-ops.site/actuator/health/readiness`는 **2026-10-14 00:17:15 UTC**에 한 번 조회하여 **200 / `{"status":"UP"}`** 확인. 운영이 작업 브랜치의 기능을 제공한다는 증거로 사용하지 않는다.
- main 병합·운영 배포·비용 활성화·운영 인증 정책 변경은 미승인 상태다.

