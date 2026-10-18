#!/usr/bin/env bash
# 서비스·태그·저장소 계정은 로컬에서 검증한 뒤 원격 명령에 넣는다.
# shellcheck disable=SC2029
set -euo pipefail

case "$DEPLOY_SERVICE" in agent|backend) ;; *) exit 2 ;; esac
[[ "$IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]
case "$IMAGE_TAG" in latest|dev|main|"") exit 2 ;; esac

release_directory="/opt/freelance-ops/releases/$DEPLOY_SERVICE/$IMAGE_TAG"
case "${1:-}" in
    validate) ;;
    upload)
        tar -czf deployment.tgz docker-compose.yaml docker-compose.production.yaml infra/caddy infra/scripts
        ssh "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '$release_directory'"
        scp deployment.tgz "$DEPLOY_USER@$DEPLOY_HOST:$release_directory/"
        ssh "$DEPLOY_USER@$DEPLOY_HOST" "cd '$release_directory' && tar -xzf deployment.tgz"
        ;;
    deploy)
        [[ "$GHCR_USER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]
        # 토큰은 명령 인자나 로그에 넣지 않고 원격 표준 입력으로 전달한다.
        printf '%s' "$GHCR_TOKEN" | ssh "$DEPLOY_USER@$DEPLOY_HOST" "docker login ghcr.io --username '$GHCR_USER' --password-stdin"
        ssh "$DEPLOY_USER@$DEPLOY_HOST" "cd '$release_directory' && chmod +x infra/scripts/*.sh && DEPLOY_ROOT=/opt/freelance-ops ./infra/scripts/deploy-service.sh $DEPLOY_SERVICE '$IMAGE_TAG'"
        ;;
    *) exit 2 ;;
esac
