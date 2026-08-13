#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: deploy.sh <immutable-image-tag>" >&2
    exit 2
fi

DEPLOY_IMAGE_TAG="$1"
if ! printf '%s' "$DEPLOY_IMAGE_TAG" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'; then
    echo "deployment image tag contains unsupported characters" >&2
    exit 2
fi
case "$DEPLOY_IMAGE_TAG" in
    latest|dev|main|"")
        echo "deployment requires an immutable image tag" >&2
        exit 2
        ;;
esac

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/freelance-ops}"
ENV_FILE="${ENV_FILE:-$DEPLOY_ROOT/.env}"
COMPOSE="docker compose --env-file $ENV_FILE -f docker-compose.yaml -f docker-compose.production.yaml"
PREVIOUS_TAG=""
if [ -f "$DEPLOY_ROOT/.deployed-tag" ]; then
    PREVIOUS_TAG="$(cat "$DEPLOY_ROOT/.deployed-tag")"
fi

rollback() {
    if [ -n "$PREVIOUS_TAG" ]; then
        echo "deployment failed; rolling back to $PREVIOUS_TAG" >&2
        DEPLOY_IMAGE_TAG="$PREVIOUS_TAG" $COMPOSE up -d --no-build --wait
    fi
}

trap rollback INT TERM HUP EXIT
export DEPLOY_IMAGE_TAG
$COMPOSE config --quiet
$COMPOSE pull backend agent caddy
$COMPOSE up -d --no-build --wait
curl --fail --silent --show-error "http://127.0.0.1:${BACKEND_PORT:-8080}/actuator/health/readiness" >/dev/null
printf '%s\n' "$DEPLOY_IMAGE_TAG" > "$DEPLOY_ROOT/.deployed-tag"
trap - INT TERM HUP EXIT
