#!/usr/bin/env bash
set -euo pipefail

ssh "$DEPLOY_USER@$DEPLOY_HOST" 'bash -se' <<'SCRIPT'
mapfile -t postgres_container_ids < <(
    docker ps \
        --filter label=com.docker.compose.project=freelance-ops-v2-infra \
        --filter label=com.docker.compose.service=postgres \
        --format '{{.ID}}'
)
if [ "${#postgres_container_ids[@]}" -ne 1 ]; then
    echo "운영 PostgreSQL 컨테이너가 정확히 하나여야 합니다." >&2
    exit 1
fi
docker exec "${postgres_container_ids[0]}" \
    psql --username postgres --dbname freelance_ops --set=ON_ERROR_STOP=1 \
    --command 'CREATE EXTENSION IF NOT EXISTS btree_gist'
SCRIPT
