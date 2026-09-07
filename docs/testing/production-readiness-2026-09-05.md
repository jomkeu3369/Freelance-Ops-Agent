# 운영 준비 자동 점검 — 2026-09-05

> 후속 상태: 이 문서는 수정 전 점검 이력이다. 우선 문제 세 가지의 수정과 최신 검증 결과는 [운영 준비 보완 보고서](production-readiness-remediation-2026-09-05.md)를 따른다.

## 판정

**운영 적합 판정 보류.** 자동 회귀와 작은 합성 데이터의 로컬 부하는 통과했지만, DB 장애를 정상으로 표시하는 readiness와 서비스 권한을 복구하지 못하는 restore 경로가 실제로 재현됐다. PDF 의존성의 알려진 취약점도 정리해야 한다. 기능 수동 검수와 운영 환경의 장기 관측은 별도다.

소스 기준은 `main` / `c1270de80ab1f9c3eb55cda6ae33165116666719`다. 로컬을 12개 커밋 fast-forward했고 사용자 작업 트리는 처음에 깨끗했다. 이번 변경은 k6 검증 도구와 결과 문서이며 애플리케이션·dependency lock·배포 설정은 변경하지 않았다. commit·push·배포는 수행하지 않았다.

## 자동 검증 결과

| 항목 | 결과 | 범위 |
|---|---|---|
| Backend | 213 passed, 실패·skip 0 | 실제 pgvector Testcontainers 11건 포함; 인증·RBAC·workspace 격리·업무 무결성·Task 계약 |
| Agent | 294 passed, 실패·skip 0 | 실제 PostgreSQL 통합 8건 포함; checkpoint·FIFO·cancel·redirect·outbox |
| Frontend | 45 passed, 실패·skip 0 | TypeScript·ESLint·production build 통과; localhost HTTP shell smoke 4/4 |
| 추가 검사 | 통과 | Agent Ruff, strict mypy 80개 파일, Python SDK 2건, 기존 고정 평가 release gate |
| 계약·설정 | 통과 | OpenAPI 2개, infra/app/production Compose 3개, 운영 shell 문법 4개 |
| 이미지 | 통과 | 최신 Backend Dockerfile fresh Linux build와 production profile 시작 |
| Frontend dependency audit | 알려진 취약점 0 | npm lock 기준; 2026-09-05 registry 조회 |
| Agent dependency audit | 실패 | 운영 lock 106개 버전, skip 0; `pypdf==6.15.0` 취약점 3건 |

Backend service 테스트 일부는 mock 기반이다. ACK 유실 mock 회귀는 실제 운영 네트워크 장애 훈련과 다르다. Agent DB 통합 8건은 postgres superuser로 실행했으므로 운영 app/agent credential의 최소권한까지 통과한 의미가 아니다. Frontend 테스트 상당수는 source/utility 검사이며 실제 로그인·견적 사용 흐름을 검증하지 않는다. 고정 평가 gate는 기존 보고서 검증이고 새 실모델 평가가 아니다. Java dependency 및 전체 컨테이너 OS vulnerability audit는 이번 범위에서 실행하지 않았다.

Windows에서는 Gradle ASCII drive와 저장소 cache를 사용했고 Python DB 검증에는 psycopg의 Selector 이벤트 루프 래퍼가 필요했다. Node 22.23.2를 별도 portable 환경으로 사용했다. sandbox 접근 오류는 정식 escalation 후 재검증했으며 미실행을 통과로 집계하지 않았다.

## k6 측정

검증 환경은 Windows의 k6 2.2.0 → loopback Spring API → 일회용 PostgreSQL 17 + pgvector다. Docker VM은 2 CPU / 약 3.83GiB, Backend는 **1 CPU / 640MiB / non-root / read-only filesystem / production profile**로 제한했다. 실제 provider key 대신 일회용 서명 키를 생성하고 Agent 호출·background dispatch를 비활성화했다. 실모델 비용은 발생하지 않았다.

Backend 이미지: `sha256:3d91f15f2f263c7b913257bc274e6442f6e93be0e539be78dad46c939a23bc4f`.

| 실행 | 요청 수 | p95 | p99 | 오류 / 누락 | 판정 |
|---|---:|---:|---:|---|---|
| readiness, 80초, 최고 50 RPS | 1,384 | 7.14ms | 11.43ms | 0 / 0 | 통과 |
| 업무 혼합, 보강 전 예비 실행 | 4,384 | 30.27ms | 46.66ms | 0 / 0 | 참고; 최종 검증으로 사용하지 않음 |
| 업무 혼합, 20 VU 사전 할당 | 4,382 | 33.14ms | 103.15ms | 0 / **3** | **실패, exit 99 보존** |
| 업무 혼합, 50 VU 사전 할당 재검증 | 4,384 | 44.74ms | 165.55ms | 0 / 0 | 통과 |

업무 요청 수와 지연은 setup의 35건을 제외한 `scenario:business` 기준이다. 업무 실행은 140초, 최고 부하 유지 60초다. 50 VU는 미리 확보한 발생기 capacity이며 실제 동시 사용자 50명을 측정했다는 뜻은 아니다. 재검증에서 관측된 활성 VU 최댓값은 7이었다. 앞선 누락 원인을 애플리케이션 또는 발생기로 확정하지 않았고, 실패 기록을 삭제하거나 threshold를 완화하지 않았다.

8개 경로를 균등 호출하므로 최고 50 RPS 중 정상 업무 조회는 약 31.25 RPS이고 나머지는 예상 401/404 접근 차단이다. 최종 실행은 각 경로 548회, checks 8,768/8,768 통과였다.

| 최종 실행의 정상 업무 API | p95 | p99 |
|---|---:|---:|
| 내 정보 | 46.25ms | 210.76ms |
| 프로젝트 목록 | 50.26ms | 173.48ms |
| 프로젝트 검색 | 52.09ms | 156.72ms |
| 프로젝트 상세 | 49.58ms | 193.22ms |
| 고객 목록 | 49.11ms | 150.55ms |

다른 workspace/resource는 404, 비인증은 401을 정확하게 반환했고 에러 응답에서 fixture 비공개 marker·토큰·요구사항·stack trace가 검출되지 않았다. 검색은 30개 중 1개만 반환하는 조건으로 확인했다. 각 경로 p95 <500ms, p99 <1,000ms, 실제 호출 수 >0 기준도 통과했다.

재검증 중 18개 자원 표본의 관측 최대 메모리는 478MiB, CPU는 19.46%였다. 표본 사이 peak 또는 장기 누수를 배제하는 결과는 아니다. 이 데이터는 작은 workspace의 짧은 읽기 부하 기준선이며 운영 VM·Cloudflare/Caddy/TLS·대규모 데이터·로그인 BCrypt·견적 쓰기·SSE·실모델 동시 처리 용량으로 일반화할 수 없다.

재실행 방법과 기준은 [부하 검증 문서](../../infra/load/README.md)를 따른다. 공개 서버에는 부하를 주지 않았다.

## 운영 전 해결할 사항

### 1. DB 장애를 readiness가 감지하지 못함 — 재현

일회용 DB container를 pause하고 같은 API를 조회했다.

| 상태 | 업무 DB 조회 | readiness | liveness |
|---|---|---|---|
| 정상 | 200, 36ms | 200 UP | 200 UP |
| DB pause | **500, 30,323ms** | **200 UP, 6ms** | 200 UP |
| DB unpause | 200, 23ms | 200 UP | 200 UP |

`backend/src/main/resources/application.yml`은 readiness probe를 켜지만 DB를 group에 포함하지 않는다. `docker-compose.yaml`, `infra/caddy/Caddyfile`과 CD가 이 readiness를 건강 판정에 사용하므로 실제 업무 장애 중에도 정상으로 판단한다. liveness가 UP인 것은 정상적인 분리이며, readiness에 필수 의존성을 반영하는 수정과 장애 회귀 검사가 필요하다. Agent `/health`도 정적 UP 응답이라는 별도 정적 검토 결과가 있다.

### 2. 백업 파일은 복원되지만 서비스 역할이 접근하지 못함 — 재현

저장소 `backup-postgres.sh` / `restore-drill.sh`와 동일한 `pg_dump`·`pg_restore` 옵션을 별도의 합성 DB에 적용했다. 운영 Compose script 전체나 off-host rclone은 실행하지 않았다.

- dump/restore 자체는 성공했고 관리자 조회에서 프로젝트 93개와 Flyway 성공 기록 32개를 확인했다.
- `--no-owner --no-acl`로 postgres가 복원하면 `app`·`agent_runtime` schema 소유자가 모두 postgres가 된다.
- 복원 전 정상 조회하던 `app_user`와 `agent_user`는 복원 DB에서 각각 **permission denied for schema**로 실패했다.
- script 마지막 `SELECT ... FROM flyway_schema_history`도 `app.` 한정자가 빠져 **relation does not exist**로 실패했다. 복원된 `app` schema 자체는 존재한다.

역할·schema·table·sequence 권한 복구 절차를 명시하고 실제 서비스 credential의 읽기·쓰기 및 cross-schema 거부까지 검증해야 한다. 합성 dump SHA-256: `aed5b4f08b7972a740f5b3d3fb768b0ec7d5f4e86ad2c66210d84fe01748889d`.

### 3. 외부 PDF 처리 의존성 보안 업데이트 필요 — advisory 확인

`pypdf==6.15.0`에서 알려진 moderate advisory 3건을 확인했다. 공식 수정 버전은 첫 건 6.16.0, 나머지 6.16.1이다. [무한 루프 권고](https://github.com/py-pdf/pypdf/security/advisories/GHSA-jp53-mhqp-8xcg), [outline 자원 소모 권고](https://github.com/py-pdf/pypdf/security/advisories/GHSA-23w6-3w8w-8484), [텍스트 추출 자원 소모 권고](https://github.com/py-pdf/pypdf/security/advisories/GHSA-763m-79hh-57f2).

`agent/src/web_research/direct.py`는 외부 PDF에 `PdfReader`와 `page.extract_text()`를 사용하므로 마지막 advisory의 코드 경로와 관련된다. 다운로드 크기·페이지 수·domain 제한은 존재하지만 파싱 연산량 제한과 같지 않다. web research 활성화 여부와 실제 악성 입력의 도달 가능성은 구분하며 악성 PDF 공격을 재현하지 않았다. 검증된 수정 버전으로 lock을 갱신하고 PDF 회귀 및 audit를 다시 실행해야 한다.

## 추가 개선과 남은 검증

- Frontend CI에 production build gate가 없다. 이번 수동 실행은 통과했으나 후속 PR마다 보장되지 않는다.
- 공개 www 페이지 1회 GET에서 HTTP 200/HSTS를 확인했고 CSP·X-Frame-Options·nosniff·Referrer-Policy는 관측되지 않았다. API readiness는 200 UP과 Caddy 보안 header를 반환했다. Frontend의 sessionStorage refresh token 저장 방식과 함께 별도 보안 검토가 필요하며 이것만으로 XSS가 발견됐다는 뜻은 아니다.
- 최신 [Agent CI/CD](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/33584497763)와 [Backend CI/CD](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/33579686471)는 성공이었다. 서버 image digest·실제 `.env`와 백업 remote는 직접 점검하지 않았다.
- Phase 11D는 최신 문서대로 **HOLD 유지**다. 실제 7일·1,000 terminal attempts, provider outage, immutable image rollback, off-host backup restore와 독립 review 증거를 로컬 회귀로 대체할 수 없다.
- FIFO dispatch context가 메모리에만 보관되는 정적 검토 사항도 있다(`agent/src/runtime/research_dispatch.py`). 실제 프로세스 재시작 후 queue reclaim과 context 복구까지 이어지는 검증이 필요하며 기존 DB 저장소 회귀만으로 이 경계를 통과했다고 볼 수 없다. 기본 비활성인 pilot의 한계로 구분한다.
- 사용자가 직접 확인할 흐름: 가입·로그인·refresh/로그아웃 → 고객/프로젝트 → OpenAI/Gemini별 분석·HITL 재개/취소 → 견적 편집·발행·공유 만료/고객 결정 → Outcome. SSE 재연결, 권한 회수, 브라우저 오류 복구와 금액·근거 품질도 확인한다.

## 로컬 원자료

`output/readiness/2026-09-05/`에 서비스별 보고서, JUnit/로그, k6 JSON, 자원 표본, `db-outage.json`, `restore-probe.json`, dependency audit와 GitHub CI 조회를 보관한다. 이 폴더는 Git에서 제외된다. 일회용 DB·API container와 서명 키 파일을 제거했고 실제 고객 데이터나 provider credential은 사용하지 않았다. 검토한 변경 파일·보고서에서 알려진 credential prefix와 private-key marker는 검출되지 않았다(전체 이력 secret audit는 아님).

종료 검사에서 접근 가능한 저장소 경로의 `__pycache__`는 0개였다. 기존 `.tmp/pytest-platform-full`·`.tmp/pytest-platform-release` 두 디렉터리는 OS 접근 거부로 내부를 확인할 수 없었고 ACL이나 기존 내용을 변경하지 않았다. 상세 결과는 `cache-cleanup.json`에 있다.
