# V2 Infrastructure

V2의 운영 데이터베이스는 PostgreSQL 17 + pgvector 하나이며 `app`과 `agent_runtime` schema 및 credential을 분리한다. 브라우저에는 Spring Boot만 공개하고 Agent와 PostgreSQL은 `freelance-ops-v2-internal` Docker network 안에서만 접근한다.

## 로컬 실행

```powershell
docker compose -f docker-compose-infra.yaml config
docker compose -f docker-compose.yaml config
docker compose -f docker-compose-infra.yaml up -d --wait
docker compose -f docker-compose.yaml up --build -d --wait
```

Backend host port는 loopback에만 bind된다. Swagger는 development profile에서 `http://127.0.0.1:8080/swagger-ui.html`로 접근한다.

## Vultr production

Production은 기본 Compose에 `docker-compose.production.yaml`을 겹쳐 사용한다.

```sh
export APP_DOMAIN=api.example.com
export BACKEND_IMAGE=ghcr.io/account/freelance-ops-backend
export AGENT_IMAGE=ghcr.io/account/freelance-ops-agent
export BACKEND_IMAGE_TAG=backend-v2.0.0-rc1
export AGENT_IMAGE_TAG=agent-v2.0.0-rc1
docker compose -f docker-compose.yaml -f docker-compose.production.yaml config
```

- Caddy `2.11.4-alpine`만 80/443을 공개하고 자동 TLS와 보안 header를 적용한다.
- Backend host port는 `127.0.0.1`에만 bind하며 Agent와 PostgreSQL host port는 없다.
- Backend와 Agent는 read-only filesystem, non-root user, `no-new-privileges`, CPU·memory·PID limit를 사용한다.
- image tag로 `latest`, `main`, `dev`를 허용하지 않는다.
- `/opt/freelance-ops/.env`는 서버에서만 관리하며 Git 또는 배포 bundle에 포함하지 않는다.

`main`의 배포 관련 변경은 `Production Auto CD`가 경로를 분류하고 관련 CI Green 이후 자동 배포한다.
서비스 단독 변경은 해당 서비스만 배포하며 공통 계약·Compose·배포 script 변경은 Agent 다음 Backend
순서로 배포한다. 자동 tag는 `agent-<git-sha>`와 `backend-<git-sha>` 형식이다.

장애 복구를 위한 Backend와 Agent의 독립 수동 배포 및 rollback은 다음 script를 사용한다.

```sh
DEPLOY_ROOT=/opt/freelance-ops ./infra/scripts/deploy-service.sh agent agent-v2.0.0-rc1
DEPLOY_ROOT=/opt/freelance-ops ./infra/scripts/deploy-service.sh backend backend-v2.0.0-rc1
```

최초 구성에서는 내부 Agent를 먼저 배포한 뒤 Backend를 배포한다. Agent CD는 Agent container만 교체하고 `/health/readiness`를 내부에서 확인한다. Backend CD는 Backend와 Caddy ingress를 반영하고 Spring readiness를 확인한다. 각 서비스는 `.agent-deployed-tag`와 `.backend-deployed-tag`에 성공한 immutable tag를 별도로 기록하며 실패 시 해당 서비스만 이전 tag로 rollback한다. 두 배포의 서버 반영 단계는 공통 GitHub concurrency group으로 직렬화된다.

Spring `/actuator/health/readiness`는 애플리케이션 준비 상태와 필수 DB 연결을 검사하며 장애 시 `503 DOWN`을 반환한다. `/actuator/health/liveness`는 DB 장애로 프로세스를 재시작하지 않도록 분리한다. Agent `/health`는 liveness이고 `/health/readiness`는 startup 완료, 구성된 checkpoint의 open 상태와 실제 DB query를 확인한다. Agent DB 점검은 프로세스당 하나만 진행하며 HTTP 대기는 1초로 제한한다. DB driver의 취소 지연이 readiness 응답을 붙잡지 않는다. Spring의 전체 health는 Agent readiness도 관측하지만 CRM readiness는 Agent 장애와 분리한다. 모델 API의 정상 처리 여부는 이 probe로 보장하지 않는다.

Spring의 기본 DB pool 획득 제한은 2초, connection 검증 제한은 1초다. PostgreSQL 연결 제한은 3초, socket 응답 제한은 10초이며 `.env`의 `DB_POOL_CONNECTION_TIMEOUT_MS`, `DB_POOL_VALIDATION_TIMEOUT_MS`, `DB_CONNECT_TIMEOUT_SECONDS`, `DB_SOCKET_TIMEOUT_SECONDS`로 조정한다. socket 제한은 전체 HTTP 요청의 절대 deadline이 아니다. 긴 query·migration이 필요한 배포에서는 운영 측정에 맞게 조정한다.

두 서비스를 같은 tag로 함께 올리는 초기 bootstrap 또는 비상 복구에는 기존 호환 script를 사용할 수 있다.

```sh
DEPLOY_ROOT=/opt/freelance-ops ./infra/scripts/deploy.sh v2.0.0-rc1
```

GitHub Actions의 자동·수동 CD는 같은 서비스별 절차와 다음 secret을 사용한다. 완전 자동 배포에서는
`production` environment에 required reviewer를 설정하지 않는다. required reviewer를 유지하면 배포가
승인 대기 상태에서 멈춘다.

- `VULTR_HOST`, `VULTR_USER`, `VULTR_SSH_PRIVATE_KEY`, `VULTR_SSH_HOST_KEY`
- `GHCR_USERNAME`, `GHCR_TOKEN`
- `PRODUCTION_BASE_URL`

## Backup과 restore drill

로컬 VM에만 dump를 남기는 것은 backup 완료로 인정하지 않는다. `BACKUP_REMOTE`는 암호화된 rclone crypt remote여야 한다.

```sh
BACKUP_REMOTE=crypt-remote:freelance-ops ./infra/scripts/backup-postgres.sh
RESTORE_DATABASE=freelance_ops_restore_drill ./infra/scripts/restore-drill.sh \
  /var/backups/freelance-ops/freelance_ops_YYYYMMDDTHHMMSSZ.dump
```

Backup은 소유권·ACL을 보존하는 PostgreSQL custom-format dump와 파일명 기준 SHA-256 manifest를 생성한 뒤 off-host remote로 복사한다. dump와 manifest를 같은 폴더에 두면 다른 경로에서도 검증할 수 있다. 복구 대상 서버에는 운영 초기화와 같은 비특권 `app_user`·`agent_user` 및 별도 credential을 먼저 구성한다. role password는 archive에 포함하지 않는다.

Restore drill은 63자 이하의 소문자·숫자·밑줄로 구성되고 `_restore_drill`로 끝나는 별도 database만 재생성한다. 선택한 archive 자체의 checksum과 role 검증 후 단일 transaction으로 복원하며 오류가 나면 중단한다. schema·table·sequence 소유권, `app.flyway_schema_history`, 서비스 계정별 실제 읽기·쓰기·identity sequence와 교차 schema 접근 거부까지 통과해야 성공한다. 읽기·쓰기 probe는 rollback하며 알 수 없는 권한에 임의 GRANT를 적용하지 않는다. 운영 database 이름을 restore target으로 사용할 수 없다.

이전 `--no-owner --no-acl` custom archive에도 owner metadata는 남아 있어 새 restore 방식으로 검증할 수 있다. 다만 저장하지 않은 ACL은 복원할 수 없으며 이전 절대 경로 manifest는 경로 이동 시 자동 호환되지 않는다. 원본 checksum으로 무결성을 먼저 확인한 뒤 신뢰된 절차로 manifest를 재발행해야 한다.

`sh infra/tests/test-backup-restore.sh`는 격리된 PostgreSQL에서 위 절차와 잘못된 소유권·격리·checksum·대상 거부를 검증하며 Contracts & Compose CI에서도 실행한다. remote 전송만 로컬 복사로 대체하므로 이 테스트는 실제 off-host 복구·credential 인증·RPO/RTO 증거를 대신하지 않는다.

실제 domain, registry, firewall, rclone crypt remote와 secret 주입이 확정되기 전에는 production 배포 완료로 간주하지 않는다.
