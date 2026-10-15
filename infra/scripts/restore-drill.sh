#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: restore-drill.sh <backup.dump>" >&2
    exit 2
fi

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
BACKUP_DIRECTORY="$(CDPATH='' cd -- "$(dirname -- "$1")" && pwd)"
BACKUP_FILE="$BACKUP_DIRECTORY/$(basename -- "$1")"
RESTORE_DATABASE="${RESTORE_DATABASE:-freelance_ops_restore_drill}"
if [ "${#RESTORE_DATABASE}" -gt 63 ]; then
    echo "RESTORE_DATABASE must not exceed PostgreSQL's 63-byte identifier limit" >&2
    exit 2
fi
case "$RESTORE_DATABASE" in
    ""|*[!a-z0-9_]*)
        echo "RESTORE_DATABASE must contain only lowercase letters, digits and underscores" >&2
        exit 2
        ;;
esac
case "$RESTORE_DATABASE" in
    *_restore_drill) ;;
    *)
        echo "RESTORE_DATABASE must end with _restore_drill" >&2
        exit 2
        ;;
esac

test -f "$BACKUP_FILE"
test -f "$BACKUP_FILE.sha256"
(cd "$BACKUP_DIRECTORY" && sha256sum --check "$(basename "$BACKUP_FILE").sha256")
# 다른 백업의 정상 manifest를 가져와도 선택한 파일의 검증을 통과할 수 없게 한다.
expected_hash="$(cut -c 1-64 "$BACKUP_FILE.sha256")"
actual_hash="$(sha256sum "$BACKUP_FILE")"
if [ "$expected_hash" != "${actual_hash%% *}" ]; then
    echo "Selected backup checksum FAILED" >&2
    exit 1
fi

compose() {
    docker compose -f "${INFRA_COMPOSE_FILE:-docker-compose-infra.yaml}" "$@"
}

# 서비스 계정의 비밀번호는 백업에 넣지 않고 복구 서버에서 별도로 설정한다.
compose exec -T postgres psql -X --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM pg_roles
        WHERE rolname IN ('app_user', 'agent_user') AND rolcanlogin
          AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls) <> 2 THEN
        RAISE EXCEPTION 'Provision non-privileged app_user and agent_user roles before restoring';
    END IF;
END $$;
SQL

compose exec -T postgres \
    dropdb --username postgres --if-exists "$RESTORE_DATABASE"
compose exec -T postgres \
    createdb --username postgres "$RESTORE_DATABASE"
compose exec -T postgres \
    pg_restore --username postgres --dbname "$RESTORE_DATABASE" --exit-on-error --single-transaction < "$BACKUP_FILE"
compose exec -T postgres \
    psql -X --username postgres --dbname "$RESTORE_DATABASE" --set ON_ERROR_STOP=1 < "$SCRIPT_DIR/verify-restore.sql"

compose exec -T postgres \
    psql -X --username app_user --dbname "$RESTORE_DATABASE" --set ON_ERROR_STOP=1 < "$SCRIPT_DIR/verify-app-access.sql"
compose exec -T postgres \
    psql -X --username agent_user --dbname "$RESTORE_DATABASE" --set ON_ERROR_STOP=1 < "$SCRIPT_DIR/verify-agent-access.sql"

echo "Restore drill passed: ownership, service-role read/write and schema isolation verified"
