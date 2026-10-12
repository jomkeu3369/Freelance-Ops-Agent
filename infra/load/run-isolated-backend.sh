#!/usr/bin/env bash
# Disposable real Spring/PostgreSQL benchmark. Never use a development/production DB.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
APP_ROOT="${LOAD_APP_ROOT:-$ROOT}"
PG_IMAGE="pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a"
API_IMAGE="eclipse-temurin@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5"
OUT="${LOAD_OUTPUT_DIR:-$ROOT/output/isolated-load}"
mkdir -p "$OUT"
export LOAD_OUTPUT_DIR="$OUT"
PG_CONTAINER="foa-load-postgres"
API_CONTAINER="foa-load-backend"
NETWORK="foa-load-internal"
for name in "$PG_CONTAINER" "$API_CONTAINER"; do
  if docker container inspect "$name" >/dev/null 2>&1; then
    echo "Refusing to touch pre-existing container $name" >&2; exit 2
  fi
done
if docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "Refusing to touch pre-existing network $NETWORK" >&2; exit 2
fi
cleanup() {
  docker logs "$API_CONTAINER" > "$OUT/backend.log" 2>&1 || true
  docker inspect --format '{{json .State}}' "$API_CONTAINER" > "$OUT/backend-final-state.json" 2>/dev/null || true
  docker rm -f "$API_CONTAINER" "$PG_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT
{
  date -u +%FT%TZ
  echo "harness=$(git rev-parse HEAD)"
  echo "product=$(git -C "$APP_ROOT" rev-parse HEAD)"
  echo "case=${LOAD_CASE:-baseline}"
  git show -s --format='%H %s' ee59296ac1b5ab4e3b3e7fb35de084900c6eb7fc
  uname -a
  lscpu
  free -m
  java -version 2>&1
  docker version --format '{{.Server.Version}}'
} > "$OUT/environment.txt"
# Dependency downloads/build occur before the runtime network is created.
(cd "$APP_ROOT/backend" && bash ./gradlew bootJar --no-daemon --console=plain)
docker pull "$PG_IMAGE"
docker pull "$API_IMAGE"
docker image inspect --format '{{json .RepoDigests}}' "$PG_IMAGE" "$API_IMAGE" >> "$OUT/environment.txt"
docker network create --internal "$NETWORK" >/dev/null
docker run -d --name "$PG_CONTAINER" --network "$NETWORK" \
  --cpus=2 --memory=2g \
  -e POSTGRES_DB=isolated_load -e POSTGRES_USER=load_admin -e POSTGRES_PASSWORD=disposable-load-only \
  "$PG_IMAGE" postgres -c shared_preload_libraries=pg_stat_statements \
  -c max_connections=100 -c shared_buffers=256MB >/dev/null
for i in $(seq 1 60); do
  if docker exec "$PG_CONTAINER" pg_isready -U load_admin -d isolated_load >/dev/null; then break; fi
  sleep 1
done
docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U load_admin -d isolated_load <<'SQL'
CREATE EXTENSION vector;
CREATE EXTENSION btree_gist;
CREATE EXTENSION pg_stat_statements;
CREATE ROLE app_user LOGIN PASSWORD 'disposable-app-only';
CREATE ROLE agent_user LOGIN PASSWORD 'unused-agent-only';
CREATE SCHEMA app AUTHORIZATION app_user;
CREATE SCHEMA agent_runtime AUTHORIZATION agent_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
JAR="$(find "$APP_ROOT/backend/build/libs" -maxdepth 1 -name '*.jar' ! -name '*-plain.jar' | head -1)"
test -n "$JAR"
# Internal Docker network has no outbound route. No provider/production secrets,
# frontend or Agent process exists. No port is published to the host.
docker run -d --name "$API_CONTAINER" --network "$NETWORK" \
  --cpus=2 --memory=2g \
  -v "$JAR:/app/backend.jar:ro" \
  -e DB_URL=jdbc:postgresql://foa-load-postgres:5432/isolated_load \
  -e SERVER_PORT=18080 -e DB_USERNAME=app_user -e DB_PASSWORD=disposable-app-only -e DB_POOL_SIZE=10 \
  -e APP_ENVIRONMENT=development -e APP_AUTH_EMAIL_VERIFICATION_REQUIRED=false \
  -e APP_AUTH_ACCESS_TOKEN_TTL_SECONDS=3600 -e APP_RATE_LIMIT_ENABLED=true \
  -e APP_NOTICES_DISPATCH_ENABLED=false -e AGENT_ROUTE_OBSERVATION_COLLECTION_ENABLED=false \
  -e AGENT_BASE_URL=http://127.0.0.1:9 \
  "$API_IMAGE" java -Xms512m -Xmx1024m -XX:ActiveProcessorCount=2 \
  -XX:+UseG1GC -Xlog:gc:stdout:time -jar /app/backend.jar >/dev/null
{
  docker exec "$API_CONTAINER" java -version 2>&1
  docker exec "$PG_CONTAINER" psql -U load_admin -d isolated_load -c 'SELECT version();'
  docker inspect --format '{{json .HostConfig}}' "$API_CONTAINER"
  docker network inspect --format '{{json .Internal}}' "$NETWORK"
} >> "$OUT/environment.txt"
API_PID="$(docker inspect --format '{{.State.Pid}}' "$API_CONTAINER")"
for i in $(seq 1 120); do
  if sudo nsenter --target "$API_PID" --net -- curl --max-time 3 --connect-timeout 1 --fail --silent http://127.0.0.1:18080/actuator/health/readiness >/dev/null; then break; fi
  if ! docker inspect --format '{{.State.Running}}' "$API_CONTAINER" | grep -q true; then
    echo 'Backend exited during startup' >&2; exit 1
  fi
  sleep 1
done
sudo nsenter --target "$API_PID" --net -- curl --max-time 3 --connect-timeout 1 --fail --silent http://127.0.0.1:18080/actuator/health/readiness > "$OUT/readiness.json"
# Enter only the existing network namespace, retaining host Python and Docker
# CLI/filesystem for observations. The generator has the same no-egress network.
sudo env LOAD_OUTPUT_DIR="$OUT" LOAD_CASE="${LOAD_CASE:-baseline}" LOAD_PROFILE="${LOAD_PROFILE:-full}" LOAD_PRODUCT_SHA="$(git -C "$APP_ROOT" rev-parse HEAD)" nsenter --target "$API_PID" --net -- python3 "$ROOT/infra/load/isolated_backend_load.py"
