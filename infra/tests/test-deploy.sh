#!/usr/bin/env sh
set -eu

REPOSITORY_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
TEST_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$TEST_DIRECTORY"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export DEPLOY_ROOT="$TEST_DIRECTORY/deployment root"
export ENV_FILE="$DEPLOY_ROOT/production env"
export TEST_LOG="$TEST_DIRECTORY/commands.log"
export TEST_FAILURE=""
mkdir -p "$TEST_DIRECTORY/bin" "$DEPLOY_ROOT"
printf 'APP_BYOK_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n' > "$ENV_FILE"

# 실제 Docker·HTTP 호출 대신 인자와 태그를 기록해 운영 서버와 분리한다.
cat > "$TEST_DIRECTORY/bin/docker" <<'SH'
#!/usr/bin/env sh
set -eu
test "$1" = compose
shift
test "$1" = --env-file
test "$2" = "$ENV_FILE"
shift 2
test "$1" = -f
test "$2" = docker-compose.yaml
test "$3" = -f
test "$4" = docker-compose.production.yaml
shift 4
printf 'backend=%s agent=%s %s\n' "$BACKEND_IMAGE_TAG" "$AGENT_IMAGE_TAG" "$*" >> "$TEST_LOG"
case "$1:$TEST_FAILURE" in
    exec:agent-readiness) exit 7 ;;
    up:signal)
        if [ "$AGENT_IMAGE_TAG" = agent-new ]; then
            kill -TERM "$PPID"
        fi
        ;;
esac
SH
cat > "$TEST_DIRECTORY/bin/curl" <<'SH'
#!/usr/bin/env sh
set -eu
printf 'curl %s\n' "$*" >> "$TEST_LOG"
test "$TEST_FAILURE" != backend-readiness
SH
chmod +x "$TEST_DIRECTORY/bin/docker" "$TEST_DIRECTORY/bin/curl"
export PATH="$TEST_DIRECTORY/bin:$PATH"

reset_deployment() {
    TEST_FAILURE=""
    : > "$TEST_LOG"
    printf 'backend-old\n' > "$DEPLOY_ROOT/.backend-deployed-tag"
    printf 'agent-old\n' > "$DEPLOY_ROOT/.agent-deployed-tag"
    rm -f "$DEPLOY_ROOT/.deployed-tag"
}

expect_failure() {
    if "$@" > "$TEST_DIRECTORY/output" 2>&1; then
        echo "FAIL: command unexpectedly succeeded: $*" >&2
        exit 1
    fi
}

assert_no_command() {
    if grep -Eq "$1" "$TEST_LOG"; then
        echo "FAIL: unexpected service command matched: $1" >&2
        exit 1
    fi
}

reset_deployment
for image_tag in latest main dev 'invalid tag' '' '-invalid'; do
    expect_failure sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" backend "$image_tag"
    expect_failure sh "$REPOSITORY_ROOT/infra/scripts/deploy.sh" "$image_tag"
done
expect_failure sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" postgres immutable-tag
test ! -s "$TEST_LOG"
echo 'PASS: invalid service and image tags rejected before Compose'

sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" backend backend-new
test "$(cat "$DEPLOY_ROOT/.backend-deployed-tag")" = backend-new
test "$(cat "$DEPLOY_ROOT/.agent-deployed-tag")" = agent-old
grep -Fq 'backend=backend-new agent=agent-old up -d --no-build --no-deps --wait backend' "$TEST_LOG"
grep -Fq 'pull backend caddy' "$TEST_LOG"
assert_no_command ' (pull|up).* agent$'
echo 'PASS: Backend deployment preserves Agent and supports spaced environment paths'

reset_deployment
sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" agent agent-new
test "$(cat "$DEPLOY_ROOT/.agent-deployed-tag")" = agent-new
test "$(cat "$DEPLOY_ROOT/.backend-deployed-tag")" = backend-old
grep -Fq 'backend=backend-old agent=agent-new up -d --no-build --no-deps --wait agent' "$TEST_LOG"
assert_no_command ' (pull|up).* (backend|caddy)$'
echo 'PASS: Agent deployment preserves Backend'

reset_deployment
TEST_FAILURE=backend-readiness
expect_failure sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" backend backend-new
test "$(cat "$DEPLOY_ROOT/.backend-deployed-tag")" = backend-old
grep -Fq 'backend=backend-old agent=agent-old up -d --no-build --no-deps --wait backend' "$TEST_LOG"
echo 'PASS: Backend readiness failure restores only Backend and preserves its marker'

reset_deployment
TEST_FAILURE=agent-readiness
expect_failure sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" agent agent-new
test "$(cat "$DEPLOY_ROOT/.agent-deployed-tag")" = agent-old
grep -Fq 'backend=backend-old agent=agent-old up -d --no-build --no-deps --wait agent' "$TEST_LOG"
echo 'PASS: Agent readiness failure restores only Agent and preserves its marker'

reset_deployment
TEST_FAILURE=signal
expect_failure sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" agent agent-new
test "$(cat "$DEPLOY_ROOT/.agent-deployed-tag")" = agent-old
test "$(grep -Fc 'backend=backend-old agent=agent-old up -d --no-build --no-deps --wait agent' "$TEST_LOG")" = 1
echo 'PASS: termination runs rollback once'

reset_deployment
rm "$DEPLOY_ROOT/.backend-deployed-tag" "$DEPLOY_ROOT/.agent-deployed-tag"
sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" agent agent-new
test ! -f "$DEPLOY_ROOT/.backend-deployed-tag"
test "$(cat "$DEPLOY_ROOT/.agent-deployed-tag")" = agent-new
assert_no_command ' (pull|up).* (backend|caddy)$'
echo 'PASS: Agent bootstrap does not start the Backend placeholder'

reset_deployment
rm "$DEPLOY_ROOT/.agent-deployed-tag"
expect_failure sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" backend backend-new
test ! -s "$TEST_LOG"
echo 'PASS: Backend bootstrap requires an Agent marker'

reset_deployment
rm "$DEPLOY_ROOT/.backend-deployed-tag" "$DEPLOY_ROOT/.agent-deployed-tag"
printf 'legacy-tag\n' > "$DEPLOY_ROOT/.deployed-tag"
sh "$REPOSITORY_ROOT/infra/scripts/deploy-service.sh" backend backend-new
grep -Fq 'backend=backend-new agent=legacy-tag config --quiet' "$TEST_LOG"
test "$(cat "$DEPLOY_ROOT/.deployed-tag")" = legacy-tag
echo 'PASS: legacy marker remains available for independent deployment'

reset_deployment
sh "$REPOSITORY_ROOT/infra/scripts/deploy.sh" release-new
for marker in .backend-deployed-tag .agent-deployed-tag .deployed-tag; do
    test "$(cat "$DEPLOY_ROOT/$marker")" = release-new
done
echo 'PASS: coordinated deployment records all markers'

reset_deployment
TEST_FAILURE=backend-readiness
expect_failure sh "$REPOSITORY_ROOT/infra/scripts/deploy.sh" release-new
test "$(cat "$DEPLOY_ROOT/.backend-deployed-tag")" = backend-old
test "$(cat "$DEPLOY_ROOT/.agent-deployed-tag")" = agent-old
grep -Fq 'backend=backend-old agent=agent-old up -d --no-build --wait' "$TEST_LOG"
echo 'PASS: coordinated readiness failure restores both previous tags'
