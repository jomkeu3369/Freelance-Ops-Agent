#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/freelance-ops}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/freelance_ops_$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"
umask 077
docker compose -f docker-compose-infra.yaml exec -T postgres \
    pg_dump --username postgres --dbname freelance_ops --format custom --no-owner --no-acl > "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"

if [ -z "$BACKUP_REMOTE" ]; then
    echo "BACKUP_REMOTE must point to an encrypted off-host rclone destination" >&2
    exit 3
fi

rclone copyto "$BACKUP_FILE" "$BACKUP_REMOTE/$(basename "$BACKUP_FILE")"
rclone copyto "$BACKUP_FILE.sha256" "$BACKUP_REMOTE/$(basename "$BACKUP_FILE.sha256")"
echo "$BACKUP_FILE"
