#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/freelance-ops}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/freelance_ops_$TIMESTAMP.dump"

if [ -z "$BACKUP_REMOTE" ]; then
    echo "BACKUP_REMOTE must point to an encrypted off-host rclone destination" >&2
    exit 3
fi

mkdir -p "$BACKUP_DIR"
umask 077
docker compose -f "${INFRA_COMPOSE_FILE:-docker-compose-infra.yaml}" exec -T postgres \
    pg_dump --username postgres --dbname freelance_ops --format custom > "$BACKUP_FILE"
# A relative manifest remains usable when the backup is downloaded elsewhere.
(cd "$BACKUP_DIR" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256")

rclone copyto "$BACKUP_FILE" "$BACKUP_REMOTE/$(basename "$BACKUP_FILE")"
rclone copyto "$BACKUP_FILE.sha256" "$BACKUP_REMOTE/$(basename "$BACKUP_FILE.sha256")"
echo "$BACKUP_FILE"
