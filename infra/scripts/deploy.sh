#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: deploy.sh <immutable-image-tag>" >&2
    exit 2
fi

TARGET_TAG="$1"

validate_tag() {
    tag="$1"
    if ! printf '%s' "$tag" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'; then
        echo "deployment image tag contains unsupported characters" >&2
        exit 2
    fi
    case "$tag" in
        latest|dev|main|"")
            echo "deployment requires an immutable image tag" >&2
            exit 2
            ;;
    esac
}

read_previous_tag() {
    marker="$1"
    if [ -f "$marker" ]; then
        cat "$marker"
    elif [ -f "$DEPLOY_ROOT/.deployed-tag" ]; then
        cat "$DEPLOY_ROOT/.deployed-tag"
    fi
}

write_tag() {
    marker="$1"
    tag="$2"
    temporary="$marker.tmp"
    printf '%s\n' "$tag" > "$temporary"
    mv "$temporary" "$marker"
}

validate_tag "$TARGET_TAG"

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/freelance-ops}"
ENV_FILE="${ENV_FILE:-$DEPLOY_ROOT/.env}"
COMPOSE="docker compose --env-file $ENV_FILE -f docker-compose.yaml -f docker-compose.production.yaml"
BACKEND_MARKER="$DEPLOY_ROOT/.backend-deployed-tag"
AGENT_MARKER="$DEPLOY_ROOT/.agent-deployed-tag"
PREVIOUS_BACKEND_TAG="$(read_previous_tag "$BACKEND_MARKER")"
PREVIOUS_AGENT_TAG="$(read_previous_tag "$AGENT_MARKER")"

rollback() {
    if [ -n "$PREVIOUS_BACKEND_TAG" ] && [ -n "$PREVIOUS_AGENT_TAG" ]; then
        echo "deployment failed; rolling back Backend to $PREVIOUS_BACKEND_TAG and Agent to $PREVIOUS_AGENT_TAG" >&2
        BACKEND_IMAGE_TAG="$PREVIOUS_BACKEND_TAG" AGENT_IMAGE_TAG="$PREVIOUS_AGENT_TAG" \
            $COMPOSE up -d --no-build --wait
    fi
}

trap rollback INT TERM HUP EXIT
export BACKEND_IMAGE_TAG="$TARGET_TAG"
export AGENT_IMAGE_TAG="$TARGET_TAG"
$COMPOSE config --quiet
$COMPOSE pull backend agent caddy
$COMPOSE up -d --no-build --wait
curl --fail --silent --show-error "http://127.0.0.1:${BACKEND_PORT:-8080}/actuator/health/readiness" >/dev/null
write_tag "$BACKEND_MARKER" "$TARGET_TAG"
write_tag "$AGENT_MARKER" "$TARGET_TAG"
write_tag "$DEPLOY_ROOT/.deployed-tag" "$TARGET_TAG"
trap - INT TERM HUP EXIT
