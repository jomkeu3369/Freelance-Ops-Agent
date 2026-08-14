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

최초 구성에서는 내부 Agent를 먼저 배포한 뒤 Backend를 배포한다. Agent CD는 Agent container만 교체하고 `/health`를 내부에서 확인한다. Backend CD는 Backend와 Caddy ingress를 반영하고 Spring readiness를 확인한다. 각 서비스는 `.agent-deployed-tag`와 `.backend-deployed-tag`에 성공한 immutable tag를 별도로 기록하며 실패 시 해당 서비스만 이전 tag로 rollback한다. 두 배포의 서버 반영 단계는 공통 GitHub concurrency group으로 직렬화된다.

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

Backup은 PostgreSQL custom-format dump와 SHA-256 manifest를 생성한 뒤 off-host remote로 복사한다. Restore drill은 이름이 `_restore_drill`로 끝나는 별도 database만 재생성하고 Flyway history를 조회한다. 운영 database 이름을 restore target으로 사용할 수 없다.

실제 domain, registry, firewall, rclone crypt remote와 secret 주입이 확정되기 전에는 production 배포 완료로 간주하지 않는다.
