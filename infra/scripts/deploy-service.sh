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

SCRIPT_DIRECTORY="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=infra/scripts/lib/deploy-common.sh
. "$SCRIPT_DIRECTORY/lib/deploy-common.sh"

validate_image_tag "$TARGET_TAG"
initialize_deployment
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
        # Agent만 선택해도 Compose는 Backend 태그를 요구한다. 이 값으로 Backend를 실행하지는 않는다.
        CURRENT_BACKEND_TAG="$TARGET_TAG"
    fi
    BACKEND_IMAGE_TAG="$CURRENT_BACKEND_TAG"
    AGENT_IMAGE_TAG="$TARGET_TAG"
    TARGET_MARKER="$AGENT_MARKER"
fi

validate_image_tag "$BACKEND_IMAGE_TAG"
validate_image_tag "$AGENT_IMAGE_TAG"

rollback() {
    echo "$SERVICE deployment diagnostics:" >&2
    compose ps "$SERVICE" >&2 || true
    compose logs --no-color --tail=200 "$SERVICE" >&2 || true
    if [ -n "$PREVIOUS_TAG" ]; then
        echo "$SERVICE deployment failed; rolling back to $PREVIOUS_TAG" >&2
        if [ "$SERVICE" = "backend" ]; then
            BACKEND_IMAGE_TAG="$PREVIOUS_TAG" AGENT_IMAGE_TAG="$AGENT_IMAGE_TAG" \
                compose up -d --no-build --no-deps --wait backend
        else
            BACKEND_IMAGE_TAG="$BACKEND_IMAGE_TAG" AGENT_IMAGE_TAG="$PREVIOUS_TAG" \
                compose up -d --no-build --no-deps --wait agent
        fi
    fi
}

# 신호는 종료 코드로 바꾸고, 복구는 EXIT에서 한 번만 실행한다.
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
trap rollback EXIT
export BACKEND_IMAGE_TAG
export AGENT_IMAGE_TAG
compose config --quiet
if [ "$SERVICE" = "backend" ]; then
    compose pull backend caddy
    compose up -d --no-build --no-deps --wait backend
    compose up -d --no-build --no-deps --wait caddy
else
    compose pull agent
    compose up -d --no-build --no-deps --wait agent
fi

if [ "$SERVICE" = "backend" ]; then
    curl --fail --silent --show-error "http://127.0.0.1:${BACKEND_PORT:-8080}/actuator/health/readiness" >/dev/null
else
    compose exec -T agent uv run --no-dev python -c \
        "import urllib.request; urllib.request.urlopen('http://localhost:8000/health/readiness', timeout=3)" >/dev/null
fi

write_deployed_tag "$TARGET_MARKER" "$TARGET_TAG"
trap - INT TERM HUP EXIT
