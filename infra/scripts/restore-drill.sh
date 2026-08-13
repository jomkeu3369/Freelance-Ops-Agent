#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: restore-drill.sh <backup.dump>" >&2
    exit 2
fi

BACKUP_FILE="$1"
RESTORE_DATABASE="${RESTORE_DATABASE:-freelance_ops_restore_drill}"
case "$RESTORE_DATABASE" in
    *_restore_drill) ;;
    *)
        echo "RESTORE_DATABASE must end with _restore_drill" >&2
        exit 2
        ;;
esac

test -f "$BACKUP_FILE"
test -f "$BACKUP_FILE.sha256"
sha256sum --check "$BACKUP_FILE.sha256"
docker compose -f docker-compose-infra.yaml exec -T postgres \
    dropdb --username postgres --if-exists "$RESTORE_DATABASE"
docker compose -f docker-compose-infra.yaml exec -T postgres \
    createdb --username postgres "$RESTORE_DATABASE"
docker compose -f docker-compose-infra.yaml exec -T postgres \
    pg_restore --username postgres --dbname "$RESTORE_DATABASE" --no-owner --no-acl < "$BACKUP_FILE"
docker compose -f docker-compose-infra.yaml exec -T postgres \
    psql --username postgres --dbname "$RESTORE_DATABASE" --tuples-only --command \
    "SELECT COUNT(*) FROM flyway_schema_history WHERE success = TRUE;"
