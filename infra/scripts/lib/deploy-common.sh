#!/usr/bin/env sh

validate_image_tag() (
    image_tag="$1"
    if ! printf '%s' "$image_tag" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'; then
        echo "deployment image tag contains unsupported characters" >&2
        exit 2
    fi
    case "$image_tag" in
        latest|dev|main)
            echo "deployment requires an immutable image tag" >&2
            exit 2
            ;;
    esac
)

read_deployed_tag() (
    marker_file="$1"
    if [ -f "$marker_file" ]; then
        cat "$marker_file"
    elif [ -f "$DEPLOY_ROOT/.deployed-tag" ]; then
        cat "$DEPLOY_ROOT/.deployed-tag"
    fi
)

write_deployed_tag() (
    marker_file="$1"
    image_tag="$2"
    temporary_file="$marker_file.tmp"
    printf '%s\n' "$image_tag" > "$temporary_file"
    mv "$temporary_file" "$marker_file"
)

initialize_deployment() {
    DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/freelance-ops}"
    ENV_FILE="${ENV_FILE:-$DEPLOY_ROOT/.env}"
    sh "$SCRIPT_DIRECTORY/ensure-byok-key.sh" "$ENV_FILE"
}

compose() {
    # 환경 파일 경로에 공백이 있어도 하나의 인자로 전달한다.
    docker compose --env-file "$ENV_FILE" \
        -f docker-compose.yaml -f docker-compose.production.yaml "$@"
}
