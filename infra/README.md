# V2 인프라

운영 데이터베이스는 PostgreSQL 17 + pgvector를 사용하며 `app`과 `agent_runtime`의 스키마와 계정을 분리한다. 브라우저에는 Spring Boot만 공개하고 Agent와 PostgreSQL은 `freelance-ops-v2-internal` Docker 네트워크 안에서만 접근한다.

## 구성과 실행 도구

모든 명령은 저장소 루트에서 실행한다. 운영 스크립트는 Linux의 POSIX `sh`를 사용하고 PostgreSQL 초기화만 `bash`를 사용한다.

| 경로                                               | 책임                                     | 필요한 도구                       |
| -------------------------------------------------- | ---------------------------------------- | --------------------------------- |
| `caddy/`                                           | TLS와 공개 API 진입점                    | Caddy, Docker Compose             |
| `postgres/init/`                                   | 최초 DB 생성 시 확장·계정·스키마 구성    | PostgreSQL 이미지의 bash·psql     |
| `scripts/deploy-service.sh`, `scripts/deploy.sh`   | 서비스별 배포·롤백, 두 서비스 동시 복구  | Docker Compose, curl              |
| `scripts/lib/deploy-common.sh`                     | 배포 태그 검증·기록, Compose 인자 처리   | 배포 스크립트에서 불러옴          |
| `scripts/ensure-byok-key.sh`                       | 개인 키 암호화에 쓸 키의 최초 생성·보존  | flock, OpenSSL                    |
| `scripts/backup-postgres.sh`                       | DB 백업·체크섬 생성과 외부 전송          | Docker Compose, sha256sum, rclone |
| `scripts/restore-drill.sh`, `scripts/verify-*.sql` | 별도 DB 복구와 소유권·서비스 권한 검증   | Docker Compose, sha256sum         |
| `load/`                                            | 준비 상태·업무 조회·Agent 접수 부하 검증 | k6                                |
| `observability/`                                   | 내부 메트릭 수집 안내와 대시보드         | Prometheus, Grafana               |
| `tests/`                                           | 배포·복구·키 보존·부하 판정의 회귀 검사  | 아래 검증 명령 참고               |

부하 시나리오와 대시보드는 [포트폴리오의 검증 자료](../docs/portfolio/ai-platform-engineering-case-study.md)에서도 참조한다. 별도 패키지 의존성 파일은 없다.

## 로컬 실행

```powershell
docker compose -f docker-compose-infra.yaml config
docker compose -f docker-compose.yaml config
docker compose -f docker-compose-infra.yaml up -d --wait
docker compose -f docker-compose.yaml up --build -d --wait
```

Backend의 호스트 포트는 loopback에만 바인딩한다. Swagger는 development 프로필에서 `http://127.0.0.1:8080/swagger-ui.html`로 접근한다.

## Vultr 운영 배포

운영에서는 기본 Compose에 `docker-compose.production.yaml`을 겹쳐 사용한다.

```sh
export APP_DOMAIN=api.example.com
export BACKEND_IMAGE=ghcr.io/account/freelance-ops-backend
export AGENT_IMAGE=ghcr.io/account/freelance-ops-agent
export BACKEND_IMAGE_TAG=backend-v2.0.0-rc1
export AGENT_IMAGE_TAG=agent-v2.0.0-rc1
docker compose -f docker-compose.yaml -f docker-compose.production.yaml config
```

- Caddy `2.11.4-alpine`만 80/443을 공개하고 자동 TLS와 보안 헤더를 적용한다.
- Backend 호스트 포트는 `127.0.0.1`에만 바인딩하며 Agent와 PostgreSQL 호스트 포트는 없다.
- Backend와 Agent에는 읽기 전용 파일시스템, 일반 사용자, `no-new-privileges`, CPU·메모리·PID 제한을 적용한다.
- 이미지 태그로 `latest`, `main`, `dev`를 허용하지 않는다.
- `/opt/freelance-ops/.env`는 서버에서만 관리하며 Git 또는 배포 묶음에 포함하지 않는다.

`main`의 배포 관련 변경은 `Production Auto CD`가 경로를 분류하고 관련 CI를 통과한 뒤 자동 배포한다.
서비스 단독 변경은 해당 서비스만 배포하며 공통 계약·Compose·배포 스크립트 변경은 Agent 다음 Backend
순서로 배포한다. 자동 태그는 `agent-<git-sha>`와 `backend-<git-sha>` 형식이다.

장애 복구를 위한 Backend와 Agent의 독립 수동 배포와 롤백에는 다음 스크립트를 사용한다.

```sh
DEPLOY_ROOT=/opt/freelance-ops ./infra/scripts/deploy-service.sh agent agent-v2.0.0-rc1
DEPLOY_ROOT=/opt/freelance-ops ./infra/scripts/deploy-service.sh backend backend-v2.0.0-rc1
```

최초 구성에서는 내부 Agent를 먼저 배포한 뒤 Backend를 배포한다. Agent CD는 Agent 컨테이너만 교체하고 `/health/readiness`를 내부에서 확인한다. Backend CD는 Backend와 Caddy를 반영하고 Spring 준비 상태를 확인한다. 각 서비스는 `.agent-deployed-tag`와 `.backend-deployed-tag`에 성공한 태그를 별도로 기록하며 실패 시 해당 서비스만 이전 태그로 되돌린다. 두 배포의 서버 반영 단계는 공통 GitHub 동시 실행 그룹으로 직렬화한다.

플랫폼 비용으로 실행하는 AI 작업은 `PLATFORM_AI_SPEND_ENABLED=false`로 기본 차단한다. 운영에서 활성화하려면 승인된 기존 계정별 주간·전체 일간/주간 USD 예산과 모델별 실행 상한을 유지한 채 `/opt/freelance-ops/.env`에 `PLATFORM_AI_SPEND_ENABLED=true`를 명시하고 Backend를 재생성해야 한다. `.env`는 Compose 변수 치환용 입력이며 모든 값을 컨테이너에 자동으로 전달하지 않는다. 이 값은 기본 Compose의 `backend.environment`에서 명시적으로 전달하며, 환경 파일 수정이나 기존 컨테이너 재시작만으로는 반영되지 않는다. 활성화는 예산·예약액·모델 상한을 초기화하거나 늘리지 않는다.

전체 견적 분석(`PROJECT_ANALYSIS`)은 네 부서의 누적 입력, 추가 질문에 대한 답변 후 재개, 다음 호출의 보수적 예약을 위해 입력 토큰 150,000개를 요청한다. 일반 대화는 50,000개, 개인 키 실행은 기존 150,000개를 유지한다. Backend의 `AGENT_QUOTA_MAX_INPUT_TOKENS` 기본값은 150,000개이며 USD 예산과 모델별 금액 상한은 별도로 계속 검사한다. 기존 운영 `.env`에 `AGENT_QUOTA_MAX_INPUT_TOKENS=50000`이 명시돼 있으면 코드 기본값보다 우선하므로, 새 프런트엔드 배포 전에 승인된 설정을 `150000`으로 반영하고 Backend를 재생성해 요청 거부를 방지한다. 기존 이미지도 같은 환경 설정을 지원하므로 현재의 검증된 불변 태그로 설정부터 반영할 수 있다. 재개 시 부서별 출력 배분은 이전 사용량을 제외한 잔여 한도에서 정하며, 48,000개 누적 출력·50회 호출과 금액 한도는 이 변경으로 늘어나지 않는다.

Spring `/actuator/health/readiness`는 애플리케이션 준비 상태와 필수 DB 연결을 검사하며 장애 시 `503 DOWN`을 반환한다. `/actuator/health/liveness`는 DB 장애로 프로세스를 재시작하지 않도록 분리한다. Agent `/health`는 프로세스 생존 여부를, `/health/readiness`는 시작 완료·체크포인트 연결·실제 DB 쿼리를 확인한다. Agent DB 점검은 프로세스당 하나만 진행하며 HTTP 대기는 1초로 제한해 DB 드라이버의 취소 지연이 준비 상태 응답을 붙잡지 않게 한다. Spring의 전체 상태는 Agent 준비 상태도 관측하지만 CRM 준비 상태는 Agent 장애와 분리한다. 모델 API의 정상 처리 여부는 별도로 확인해야 한다.

Spring의 기본 DB 풀 획득 제한은 2초, 연결 검증 제한은 1초다. PostgreSQL 연결 제한은 3초, 소켓 응답 제한은 10초이며 `.env`의 `DB_POOL_CONNECTION_TIMEOUT_MS`, `DB_POOL_VALIDATION_TIMEOUT_MS`, `DB_CONNECT_TIMEOUT_SECONDS`, `DB_SOCKET_TIMEOUT_SECONDS`로 조정한다. 소켓 제한만으로 전체 HTTP 요청의 최대 시간을 보장할 수는 없다. 긴 쿼리나 마이그레이션이 필요한 배포에서는 운영 측정에 맞게 조정한다.

두 서비스를 같은 태그로 함께 올리는 초기 구성 또는 비상 복구에는 다음 스크립트를 사용한다.

```sh
DEPLOY_ROOT=/opt/freelance-ops ./infra/scripts/deploy.sh v2.0.0-rc1
```

GitHub Actions의 자동·수동 CD는 같은 서비스별 절차와 다음 비밀 설정을 사용한다. 완전 자동 배포에서는
`production` 환경에 필수 검토자를 설정하지 않는다. 필수 검토자를 유지하면 배포가 승인 대기 상태에서 멈춘다.

- `VULTR_HOST`, `VULTR_USER`, `VULTR_SSH_PRIVATE_KEY`, `VULTR_SSH_HOST_KEY`
- `GHCR_USERNAME`, `GHCR_TOKEN`
- `PRODUCTION_BASE_URL`

## 백업과 복구 훈련

로컬 VM에만 백업을 남기는 것으로는 충분하지 않다. `BACKUP_REMOTE`에는 별도 장애 영역의 암호화된 rclone crypt 원격 저장소를 지정한다.

```sh
BACKUP_REMOTE=crypt-remote:freelance-ops ./infra/scripts/backup-postgres.sh
RESTORE_DATABASE=freelance_ops_restore_drill ./infra/scripts/restore-drill.sh \
  /var/backups/freelance-ops/freelance_ops_YYYYMMDDTHHMMSSZ.dump
```

백업은 소유권·ACL을 보존하는 PostgreSQL custom 형식의 덤프와 파일명 기준 SHA-256 체크섬 파일을 만든 뒤 외부 저장소로 복사한다. 두 파일을 같은 폴더에 두면 다른 경로에서도 검증할 수 있다. 복구 대상 서버에는 운영 초기화와 같은 비특권 `app_user`·`agent_user` 계정과 별도 비밀번호를 먼저 구성한다. 계정 비밀번호는 백업에 포함하지 않는다.

복구 훈련은 63자 이하의 소문자·숫자·밑줄로 구성되고 `_restore_drill`로 끝나는 별도 데이터베이스만 재생성한다. 선택한 백업의 체크섬과 서비스 계정을 검증한 뒤 단일 트랜잭션으로 복원하며 오류가 나면 중단한다. 스키마·테이블·시퀀스 소유권, `app.flyway_schema_history`, 서비스 계정별 실제 읽기·쓰기·자동 증가 시퀀스와 다른 스키마 접근 거부까지 통과해야 성공한다. 읽기·쓰기 검사에 사용한 변경은 롤백하며 알 수 없는 권한에 임의 GRANT를 적용하지 않는다. 운영 데이터베이스 이름을 복구 대상으로 사용할 수 없다.

이전 `--no-owner --no-acl` custom 백업에도 소유권 정보는 남아 있어 현재 복구 방식으로 검증할 수 있다. 다만 저장하지 않은 ACL은 복원할 수 없으며 절대 경로로 만든 예전 체크섬 파일은 백업 경로를 옮기면 바로 사용할 수 없다. 원본 체크섬으로 무결성을 먼저 확인한 뒤 신뢰된 절차로 체크섬 파일을 다시 만들어야 한다.

`sh infra/tests/test-backup-restore.sh`는 격리된 PostgreSQL에서 위 절차와 잘못된 소유권·격리·체크섬·대상 거부를 검증하며 Contracts & Compose CI에서도 실행한다. 원격 전송만 로컬 복사로 대체하므로 실제 외부 저장소 복구·비밀번호 인증·RPO/RTO 검증은 따로 필요하다.

실제 외부 백업과 복구 훈련의 성공 여부는 운영 기록에서 별도로 확인한다.

## 회귀 검사

```sh
shellcheck -x infra/postgres/init/*.sh infra/scripts/*.sh infra/scripts/lib/*.sh infra/tests/*.sh
sh infra/tests/test-deploy.sh
sh infra/tests/test-byok-key.sh
sh infra/tests/test-backup-restore.sh
node --experimental-vm-modules --test infra/tests/test-load.mjs
```

위 검사는 Contracts & Compose CI에서도 실행한다. 배포 검사는 Docker와 HTTP 명령을 대체해 태그·배포 대상·롤백을 검사하고, 키 검사는 임시 환경 파일만 사용한다. 백업·복구 검사는 격리된 PostgreSQL 컨테이너를 실행한다. 부하 시나리오 검사는 Node.js 22의 내장 테스트 도구로 k6 호출 경계를 대체하며 실제 트래픽이나 유료 모델 호출은 발생하지 않는다. 실제 부하 측정은 [별도 실행 안내](load/README.md)를 따른다.
