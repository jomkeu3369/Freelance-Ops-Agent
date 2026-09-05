#!/usr/bin/env sh
set -eu
export LC_ALL=C

REPOSITORY_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
TEST_DIR="${RESTORE_TEST_OUTPUT_DIR:-$(mktemp -d)}"
mkdir -p "$TEST_DIR"
TEST_DIR="$(CDPATH= cd -- "$TEST_DIR" && pwd)"
export INFRA_COMPOSE_FILE="$TEST_DIR/compose.yaml"
export COMPOSE_PROJECT_NAME="restore-regression-$(date +%s)-$$"
cat > "$INFRA_COMPOSE_FILE" <<'YAML'
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: freelance_ops
      POSTGRES_HOST_AUTH_METHOD: trust
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d freelance_ops"]
      interval: 1s
      timeout: 3s
      retries: 30
YAML

compose() {
    docker compose -f "$INFRA_COMPOSE_FILE" "$@"
}
cleanup() {
    compose down --volumes >/dev/null
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose up -d --wait
compose exec -T postgres psql -X -U postgres -d freelance_ops -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE app_user LOGIN;
CREATE ROLE agent_user LOGIN;
CREATE SCHEMA app AUTHORIZATION app_user;
CREATE SCHEMA agent_runtime AUTHORIZATION agent_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SET ROLE app_user;
CREATE TABLE app.flyway_schema_history (success boolean NOT NULL);
INSERT INTO app.flyway_schema_history VALUES (true);
CREATE TABLE app.project (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);
INSERT INTO app.project (value) VALUES ('synthetic project');
RESET ROLE;
SET ROLE agent_user;
CREATE TABLE agent_runtime.agent_run_state (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);
INSERT INTO agent_runtime.agent_run_state (value) VALUES ('synthetic checkpoint');
RESET ROLE;
SQL

# Only remote transport is replaced. Both repository scripts and PostgreSQL are real.
mkdir -p "$TEST_DIR/bin" "$TEST_DIR/remote"
cat > "$TEST_DIR/bin/rclone" <<'SH'
#!/usr/bin/env sh
set -eu
test "$1" = copyto
cp "$2" "$3"
SH
chmod +x "$TEST_DIR/bin/rclone"
export PATH="$TEST_DIR/bin:$PATH"
BACKUP_DIR="$TEST_DIR/original" BACKUP_REMOTE="$TEST_DIR/remote" \
    sh "$REPOSITORY_ROOT/infra/scripts/backup-postgres.sh" > "$TEST_DIR/backup.log"
BACKUP_FILE="$TEST_DIR/remote/$(basename "$(tail -n 1 "$TEST_DIR/backup.log")")"
test -f "$BACKUP_FILE"
sh "$REPOSITORY_ROOT/infra/scripts/restore-drill.sh" "$BACKUP_FILE" > "$TEST_DIR/restore.log" 2>&1
echo "PASS: moved backup preserves ownership, read/write, sequences and isolation"

expect_failure() {
    name="$1"
    reason="$2"
    shift 2
    if "$@" > "$TEST_DIR/$name.log" 2>&1; then
        echo "FAIL: $name unexpectedly succeeded" >&2
        exit 1
    fi
    if ! grep -Fq "$reason" "$TEST_DIR/$name.log"; then
        echo "FAIL: $name failed for an unexpected reason" >&2
        cat "$TEST_DIR/$name.log" >&2
        exit 1
    fi
    echo "PASS: $name rejected"
}
make_dump() {
    name="$1"
    compose exec -T postgres pg_dump -U postgres -d freelance_ops -Fc > "$TEST_DIR/$name.dump"
    (cd "$TEST_DIR" && sha256sum "$name.dump" > "$name.dump.sha256")
}

expect_failure unsafe-target 'RESTORE_DATABASE must end with' env RESTORE_DATABASE=freelance_ops \
    sh "$REPOSITORY_ROOT/infra/scripts/restore-drill.sh" "$BACKUP_FILE"
long_prefix="$(printf '%064d' 0)"
expect_failure truncated-target '63-byte identifier limit' env RESTORE_DATABASE="${long_prefix}_restore_drill" \
    sh "$REPOSITORY_ROOT/infra/scripts/restore-drill.sh" "$BACKUP_FILE"
cp "$BACKUP_FILE" "$TEST_DIR/corrupt.dump"
printf '%064d  corrupt.dump\n' 0 > "$TEST_DIR/corrupt.dump.sha256"
expect_failure checksum 'FAILED' sh "$REPOSITORY_ROOT/infra/scripts/restore-drill.sh" "$TEST_DIR/corrupt.dump"
cp "$BACKUP_FILE" "$TEST_DIR/other.dump"
cp "$BACKUP_FILE" "$TEST_DIR/mismatched.dump"
printf 'corrupted' >> "$TEST_DIR/mismatched.dump"
(cd "$TEST_DIR" && sha256sum other.dump > mismatched.dump.sha256)
expect_failure wrong-manifest 'Selected backup checksum FAILED' \
    sh "$REPOSITORY_ROOT/infra/scripts/restore-drill.sh" "$TEST_DIR/mismatched.dump"

compose exec -T postgres psql -X -U postgres -d freelance_ops -v ON_ERROR_STOP=1 -c 'ALTER ROLE app_user NOLOGIN;'
expect_failure role-preflight 'Provision non-privileged' sh "$REPOSITORY_ROOT/infra/scripts/restore-drill.sh" "$BACKUP_FILE"
compose exec -T postgres psql -X -U postgres -d freelance_ops -v ON_ERROR_STOP=1 -c 'ALTER ROLE app_user LOGIN; ALTER TABLE app.project OWNER TO postgres;'
make_dump wrong-owner
expect_failure wrong-owner 'must retain their service-role owners' env RESTORE_DATABASE=owner_restore_drill \
    sh "$REPOSITORY_ROOT/infra/scripts/restore-drill.sh" "$TEST_DIR/wrong-owner.dump"
compose exec -T postgres psql -X -U postgres -d freelance_ops -v ON_ERROR_STOP=1 -c 'ALTER TABLE app.project OWNER TO app_user; GRANT USAGE ON SCHEMA app TO agent_user;'
make_dump cross-schema
expect_failure cross-schema 'must remain isolated across schemas' env RESTORE_DATABASE=isolation_restore_drill \
    sh "$REPOSITORY_ROOT/infra/scripts/restore-drill.sh" "$TEST_DIR/cross-schema.dump"
compose exec -T postgres psql -X -U postgres -d freelance_ops -v ON_ERROR_STOP=1 -c 'REVOKE USAGE ON SCHEMA app FROM agent_user;'

# Custom-format pg_dump retains owner metadata even with the old --no-owner flag.
compose exec -T postgres pg_dump -U postgres -d freelance_ops -Fc --no-owner --no-acl > "$TEST_DIR/legacy.dump"
(cd "$TEST_DIR" && sha256sum legacy.dump > legacy.dump.sha256)
RESTORE_DATABASE=legacy_restore_drill sh "$REPOSITORY_ROOT/infra/scripts/restore-drill.sh" "$TEST_DIR/legacy.dump" > "$TEST_DIR/legacy.log" 2>&1
echo "PASS: legacy custom archive retains service owners on restore"

remaining="$(compose exec -T postgres psql -X -U postgres -d freelance_ops -At -c 'SELECT COUNT(*) FROM app.project;')"
test "$remaining" = 1
echo "PASS: source database unchanged; no off-host recovery claim is made"
