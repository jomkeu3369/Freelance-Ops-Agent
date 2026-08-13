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
export DEPLOY_IMAGE_TAG=v2.0.0-rc1
docker compose -f docker-compose.yaml -f docker-compose.production.yaml config
```

- Caddy `2.11.4-alpine`만 80/443을 공개하고 자동 TLS와 보안 header를 적용한다.
- Backend host port는 `127.0.0.1`에만 bind하며 Agent와 PostgreSQL host port는 없다.
- Backend와 Agent는 read-only filesystem, non-root user, `no-new-privileges`, CPU·memory·PID limit를 사용한다.
- image tag로 `latest`, `main`, `dev`를 허용하지 않는다.
- `/opt/freelance-ops/.env`는 서버에서만 관리하며 Git 또는 배포 bundle에 포함하지 않는다.

수동 배포와 rollback은 다음 script를 사용한다.

```sh
DEPLOY_ROOT=/opt/freelance-ops ./infra/scripts/deploy.sh v2.0.0-rc1
```

배포 script는 config 검증, image pull, health 대기와 loopback readiness 확인 후 tag를 기록한다. 실패하면 이전 `.deployed-tag`로 자동 rollback한다. GitHub Actions의 `V2 Production CD`는 같은 절차를 사용하며 production environment approval과 다음 secret이 필요하다.

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
