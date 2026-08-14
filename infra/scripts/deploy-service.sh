#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ]; then
    echo "usage: deploy-service.sh <backend|agent> <immutable-image-tag>" >&2
    exit 2
fi

SERVICE="$1"
TARGET_TAG="$2"

case "$SERVICE" in
    backend|agent) ;;
    *)
        echo "deployment service must be backend or agent" >&2
        exit 2
        ;;
esac

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

read_deployed_tag() {
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
CURRENT_BACKEND_TAG="$(read_deployed_tag "$BACKEND_MARKER")"
CURRENT_AGENT_TAG="$(read_deployed_tag "$AGENT_MARKER")"

if [ "$SERVICE" = "backend" ]; then
    PREVIOUS_TAG="$CURRENT_BACKEND_TAG"
    if [ -z "$CURRENT_AGENT_TAG" ]; then
        echo "Agent has no deployed tag; run the coordinated deploy.sh once before independent deployment" >&2
        exit 2
    fi
    BACKEND_IMAGE_TAG="$TARGET_TAG"
    AGENT_IMAGE_TAG="$CURRENT_AGENT_TAG"
    TARGET_MARKER="$BACKEND_MARKER"
else
    PREVIOUS_TAG="$CURRENT_AGENT_TAG"
    if [ -z "$CURRENT_BACKEND_TAG" ]; then
        # Compose validates image interpolation for every declared service even
        # when only Agent is selected. The placeholder is not pulled or started.
        CURRENT_BACKEND_TAG="$TARGET_TAG"
    fi
    BACKEND_IMAGE_TAG="$CURRENT_BACKEND_TAG"
    AGENT_IMAGE_TAG="$TARGET_TAG"
    TARGET_MARKER="$AGENT_MARKER"
fi

validate_tag "$BACKEND_IMAGE_TAG"
validate_tag "$AGENT_IMAGE_TAG"

rollback() {
    if [ -n "$PREVIOUS_TAG" ]; then
        echo "$SERVICE deployment failed; rolling back to $PREVIOUS_TAG" >&2
        if [ "$SERVICE" = "backend" ]; then
            BACKEND_IMAGE_TAG="$PREVIOUS_TAG" AGENT_IMAGE_TAG="$AGENT_IMAGE_TAG" \
                $COMPOSE up -d --no-build --no-deps --wait backend
        else
            BACKEND_IMAGE_TAG="$BACKEND_IMAGE_TAG" AGENT_IMAGE_TAG="$PREVIOUS_TAG" \
                $COMPOSE up -d --no-build --no-deps --wait agent
        fi
    fi
}

trap rollback INT TERM HUP EXIT
export BACKEND_IMAGE_TAG
export AGENT_IMAGE_TAG
$COMPOSE config --quiet
if [ "$SERVICE" = "backend" ]; then
    $COMPOSE pull backend caddy
    $COMPOSE up -d --no-build --no-deps --wait backend
    $COMPOSE up -d --no-build --no-deps --wait caddy
else
    $COMPOSE pull agent
    $COMPOSE up -d --no-build --no-deps --wait agent
fi

if [ "$SERVICE" = "backend" ]; then
    curl --fail --silent --show-error "http://127.0.0.1:${BACKEND_PORT:-8080}/actuator/health/readiness" >/dev/null
else
    $COMPOSE exec -T agent uv run --no-dev python -c \
        "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=2)" >/dev/null
fi

write_tag "$TARGET_MARKER" "$TARGET_TAG"
trap - INT TERM HUP EXIT
