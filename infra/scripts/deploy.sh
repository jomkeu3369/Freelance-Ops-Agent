#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: deploy.sh <immutable-image-tag>" >&2
    exit 2
fi

TARGET_TAG="$1"
SCRIPT_DIRECTORY="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=infra/scripts/lib/deploy-common.sh
. "$SCRIPT_DIRECTORY/lib/deploy-common.sh"

validate_image_tag "$TARGET_TAG"
initialize_deployment
BACKEND_MARKER="$DEPLOY_ROOT/.backend-deployed-tag"
AGENT_MARKER="$DEPLOY_ROOT/.agent-deployed-tag"
PREVIOUS_BACKEND_TAG="$(read_deployed_tag "$BACKEND_MARKER")"
PREVIOUS_AGENT_TAG="$(read_deployed_tag "$AGENT_MARKER")"

rollback() {
    if [ -n "$PREVIOUS_BACKEND_TAG" ] && [ -n "$PREVIOUS_AGENT_TAG" ]; then
        echo "deployment failed; rolling back Backend to $PREVIOUS_BACKEND_TAG and Agent to $PREVIOUS_AGENT_TAG" >&2
        BACKEND_IMAGE_TAG="$PREVIOUS_BACKEND_TAG" AGENT_IMAGE_TAG="$PREVIOUS_AGENT_TAG" \
            compose up -d --no-build --wait
    fi
}

# 신호는 종료 코드로 바꾸고, 복구는 EXIT에서 한 번만 실행한다.
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
trap rollback EXIT
export BACKEND_IMAGE_TAG="$TARGET_TAG"
export AGENT_IMAGE_TAG="$TARGET_TAG"
compose config --quiet
compose pull backend agent caddy
compose up -d --no-build --wait
curl --fail --silent --show-error "http://127.0.0.1:${BACKEND_PORT:-8080}/actuator/health/readiness" >/dev/null
write_deployed_tag "$BACKEND_MARKER" "$TARGET_TAG"
write_deployed_tag "$AGENT_MARKER" "$TARGET_TAG"
write_deployed_tag "$DEPLOY_ROOT/.deployed-tag" "$TARGET_TAG"
trap - INT TERM HUP EXIT
