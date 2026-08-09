#!/usr/bin/env bash
set -euo pipefail

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_DB_PASSWORD" \
  --set=agent_password="$AGENT_DB_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;

CREATE ROLE app_user LOGIN PASSWORD :'app_password';
CREATE ROLE agent_user LOGIN PASSWORD :'agent_password';

CREATE SCHEMA app AUTHORIZATION app_user;
CREATE SCHEMA agent_runtime AUTHORIZATION agent_user;

GRANT CONNECT ON DATABASE freelance_ops TO app_user, agent_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL

