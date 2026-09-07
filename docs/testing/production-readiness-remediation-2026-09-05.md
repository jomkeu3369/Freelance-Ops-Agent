# 운영 준비 점검 보완 결과 — 2026-09-05

`main`의 `c1270de` 기준 [최초 점검](production-readiness-2026-09-05.md)에서 재현된 우선 문제 세 가지를 수정하고 로컬에서 재검증했다. **DB readiness·복구 권한·PDF 의존성 보완은 통과했으며 운영 적합 판정은 계속 보류한다.** 현재 결과는 미커밋 작업 트리 기준이다. Frontend, 운영 배포, 실모델 호출은 이번 작업 범위에 포함하지 않았다.

## 변경과 검증 결과

| 항목 | 보완 | 최종 검증 |
|---|---|---|
| Spring 장애 탐지 | readiness에 DB 포함, liveness 분리, 1초 connection 검증, pool·socket 대기 제한 | 실제 PostgreSQL pause 시 503 DOWN, 복구 후 200 UP |
| Agent 장애 탐지 | `/health/readiness` 추가, startup·checkpoint·DB 점검, 진행 중인 DB probe 하나 공유 | 실제 DB 중단에서 약 1초 내 503; liveness UP 유지 |
| 배포 판정 | Compose와 Agent CD가 새 readiness 사용, Spring 전체 health도 Agent readiness 관측 | OpenAPI 2개·Compose 3개·shell 문법 통과 |
| Backup/restore | owner·ACL 보존, 이동 가능한 checksum, role 사전 검증, 단일 transaction 복구 | 실제 PostgreSQL 회귀 10개 통과 |
| 복구 후 사용 가능성 | schema/table/sequence owner, Flyway, 서비스 계정 읽기·쓰기·교차 schema 차단 검사 | 정상 복구 성공; 잘못된 owner·격리·checksum·대상 거부 |
| PDF 의존성 | `pypdf` 6.15.0 → 6.16.1, 실제 PDF 추출·페이지 제한·손상 입력 회귀 | 운영 의존성 106개 audit에서 알려진 취약점 0건 |
| 회귀 자동화 | Agent CI를 `agent_user`로 실행, 운영 초기화 script 재사용, 복구 회귀 CI 추가 | 동일 권한으로 로컬 migration·전체 테스트 통과; GitHub 실행은 미실시 |

Spring CRM readiness는 Agent 장애와 분리한다. 전체 health의 Agent 관측을 CRM 트래픽 차단 조건으로 삼지 않는다. Agent `/health`는 기존 liveness 의미를 유지하고 새 readiness만 DB 의존성을 검사한다. provider의 실제 성공·견적 품질을 health 응답으로 판단하지 않는다.

Spring의 기본 pool 획득/검증 제한은 2초/1초, PostgreSQL connect/socket 제한은 3초/10초다. Compose와 `.env.example`에 조정 변수를 연결했다. socket 제한은 전체 HTTP deadline과 다르며 긴 query·migration에는 운영 측정에 따른 조정이 필요하다.

## 자동 회귀

| 검증 | 결과 |
|---|---|
| Backend 전체 JUnit + bootJar | 217 passed, 실패·skip 0; 실제 PostgreSQL 12개 포함 |
| Agent 전체 pytest | 302 passed, 실패·skip 0; 실제 PostgreSQL 8개 포함 |
| Agent Ruff / strict mypy | 통과 / 81 source files 통과 |
| Backup/restore shell 회귀 | 10개 통과; 원본 DB 변경 없음 |
| OpenAPI / Compose | 계약 2개 / 구성 3개 통과 |
| Agent production dependency audit | 고정 버전 106개, 알려진 취약점 0건 |

Backend는 저장소 Gradle wrapper·Java 21·ASCII 드라이브를 사용했다. Agent는 locked uv 환경·Python 3.12와 Windows Selector 이벤트 루프를 사용했다. Starlette TestClient의 httpx deprecation warning 1건은 남아 있다. 기존 DB를 재사용한 반복 실행에서는 통합 테스트의 고정 ID가 충돌해 2건 실패했으며 기록을 보존했다. 최종 302건은 새 일회용 DB에 migration 후 비특권 `agent_user`로 실행한 결과다. 새 GitHub CI도 독립 PostgreSQL에서 같은 초기화와 서비스 계정을 사용한다.

## 실제 DB 장애 재현

수정된 Backend JAR는 기존 Java 21 runtime 이미지에 읽기 전용 mount하고 1 CPU·640MiB·non-root·read-only filesystem·production profile로 실행했다. Agent는 Windows 로컬 프로세스에서 postgres run store/checkpointer와 development 설정을 사용했다. PostgreSQL 17 + pgvector는 운영 초기화 script로 계정·schema를 나눈 일회용 컨테이너다. 실제 provider credential은 사용하지 않았다.

| 최종 동시 점검 | DB 중단 상태 | DB 복구 직후 |
|---|---|---|
| Spring readiness | 503 DOWN, 1,063ms | 200 UP, 24ms |
| Agent readiness | 503 DOWN, 1,038ms | 200 UP, 14ms |
| Spring / Agent liveness | 200 UP / 200 UP | 200 UP / 200 UP |
| 업무 DB 조회 | 500, 2,082ms | 200, 43ms |

업무 조회를 readiness보다 먼저 실행하는 조건도 별도로 통과했다. 이때 업무 조회는 2,015ms에 500, Spring readiness는 2,011ms에 503, Agent readiness는 1,012ms에 503이었다. DB 중단 동안 업무 요청 자체가 성공하게 만드는 변경은 아니다.

초기 구현의 `asyncio.timeout(1)`만으로는 실제 psycopg 취소 대기를 제한하지 못해 HTTP 40초 timeout이 재현됐다. 최종 구현은 HTTP 대기와 진행 중인 DB 점검을 분리하고 프로세스당 하나만 유지한다. 동시 요청 20개가 하나의 probe를 공유하고 취소 지연에 묶이지 않는 회귀를 추가했다. 이 장애 시도와 서버 startup 전 접근 실패 기록도 원자료에 보존했다.

## k6 재검증

| 시나리오 | 측정 요청 | p95 | 오류 / 누락 | 결과 |
|---|---:|---:|---:|---|
| readiness, 80초, 최고 50 RPS | 1,384 | 11.48ms | 0 / 0 | 통과 |
| 혼합 업무, 140초, 최고 50 RPS를 60초 유지 | 4,384 | 21.77ms | 0 / 0 | 통과 |

업무 setup 요청 35개는 별도로 총 HTTP 요청은 4,419개다. 업무 checks는 8,768/8,768 통과했다. 각 API의 p95 <500ms·p99 <1,000ms, 전체 오류율, 모든 경로 호출, 요청 누락 0건 threshold를 통과했고 두 k6 process exit code는 0이다. 이번 summary에는 p99 수치 자체를 export하지 않았으므로 수치를 추정하지 않는다.

8개 경로 중 5개는 정상 조회, 3개는 예상 401/404 권한 차단이다. 최고 50 RPS를 정상 업무 50 RPS 또는 실모델 처리량으로 해석하지 않는다. 작은 합성 fixture·짧은 로컬 측정이므로 이전 p95와의 차이를 성능 개선 효과로 단정하지 않는다.

## 남은 운영 검증

- 사용자의 실제 OpenAI/Gemini 분석·HITL·견적 발행/공유·Outcome·SSE/브라우저 복구 검수.
- 실제 암호화 off-host backup 복구, credential 인증, RPO/RTO, immutable image rollback와 운영 SLO 측정. 새 복구 회귀는 실제 PostgreSQL을 쓰지만 remote 전송은 로컬 복사로 대체한다.
- Phase 11D의 실제 7일·1,000 terminal attempts와 독립 검토. FIFO dispatch context의 프로세스 재시작 복구는 추가 검증이 필요하므로 pilot은 HOLD를 유지한다.
- Frontend production build gate·보안 header·session token 보관 검토는 후속 범위로 남긴다. 이번에 Frontend 파일을 수정하거나 다시 검증하지 않았다.
- Java 의존성과 컨테이너 OS 전체 취약점 audit는 이번 검증에 포함하지 않았다. pypdf audit 0건은 모든 구성요소의 보안 보장을 의미하지 않는다.

## 원자료와 참고

Git 제외 `output/readiness-fixes/2026-09-05/`에 JUnit·pytest·정적 검사·audit·k6·DB 장애 JSON·복구 로그를 보관한다. 이전 `output/readiness/2026-09-05/`의 최초 점검 기록은 유지했다. 새 테스트 서버·DB·임시 키는 제거했다. 접근 가능한 `__pycache__` 30개를 제거했고 잔여는 0개다. 기존 `.tmp/pytest-platform-full`·`.tmp/pytest-platform-release`는 OS 접근 거부로 내부를 확인하지 못했으며 ACL을 변경하지 않았다. 변경 파일 29개의 알려진 credential/private-key marker 검사에서 검출은 없었고 `git diff --check`를 통과했다. commit·push·운영 배포는 수행하지 않았다.

복구 flag 의미는 [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)와 [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), health group 구성은 [Spring Boot Actuator](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)를 참고했다. PDF 수정 대상 advisory는 최초 점검 보고서에 연결돼 있다.
