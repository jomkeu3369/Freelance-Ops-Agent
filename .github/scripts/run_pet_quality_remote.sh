#!/usr/bin/env bash
# 운영 서비스의 소스·DB·환경 설정은 바꾸지 않는다. 임시 경로에서 합성 평가만 실행한다.
set -euo pipefail
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]]
stage="/tmp/pet-quality-$GITHUB_SHA-$GITHUB_RUN_ID"
tar -C agent -czf pet-quality-source.tgz src evaluation
ssh "$DEPLOY_USER@$DEPLOY_HOST" "install -m 700 -d '$stage'"
scp pet-quality-source.tgz "$DEPLOY_USER@$DEPLOY_HOST:$stage/source.tgz"
status=0
ssh "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- "$stage" <<'REMOTE' || status=$?
set -euo pipefail
stage="$1"
[[ "$stage" =~ ^/tmp/pet-quality-[0-9a-f]{40}-[0-9]+$ ]]
mapfile -t agents < <(docker ps -q --filter label=com.docker.compose.service=agent)
[[ "${#agents[@]}" == 1 ]]
container="${agents[0]}"
cleanup() {
  docker cp "$container:$stage/report.json" "$stage/report.json" 2>/dev/null || true
  docker exec "$container" sh -c 'rm -rf -- "$1"' sh "$stage" || true
}
trap cleanup EXIT
docker exec "$container" mkdir -p "$stage"
docker cp "$stage/source.tgz" "$container:$stage/source.tgz"
docker exec "$container" tar --no-same-owner -xzf "$stage/source.tgz" -C "$stage"
docker exec -e "PYTHONPATH=$stage/src" -e PYTHONDONTWRITEBYTECODE=1 \
  -e LANGSMITH_TRACING=false -e LANGSMITH_TRACING_V2=false \
  "$container" /app/.venv/bin/python -m evaluation.pet_quality \
  --live --model gpt-6-luna --output "$stage/report.json"
REMOTE
scp "$DEPLOY_USER@$DEPLOY_HOST:$stage/report.json" pet-quality-live.json || status=1
ssh "$DEPLOY_USER@$DEPLOY_HOST" "rm -f -- '$stage/source.tgz' '$stage/report.json'; rmdir -- '$stage'" || true
exit "$status"
