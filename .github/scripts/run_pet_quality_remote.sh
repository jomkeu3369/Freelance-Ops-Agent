#!/usr/bin/env bash
# 운영 서비스의 소스·DB·환경 설정은 바꾸지 않는다. 임시 경로에서 합성 평가만 실행한다.
# stage는 아래에서 해시·숫자로 검증한 뒤 원격 명령에 전달한다.
# shellcheck disable=SC2029
set -euo pipefail
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]]
stage="/tmp/pet-quality-$GITHUB_SHA-$GITHUB_RUN_ID"
case_list="${PET_QUALITY_CASES:-}"
[[ "$case_list" =~ ^([a-z0-9-]+(,[a-z0-9-]+)*)?$ ]]
tar --exclude='__pycache__' --exclude='*.pyc' -C agent -czf pet-quality-source.tgz src evaluation resources
ssh "$DEPLOY_USER@$DEPLOY_HOST" "install -m 700 -d '$stage'"
scp pet-quality-source.tgz "$DEPLOY_USER@$DEPLOY_HOST:$stage/source.tgz"
status=0
ssh "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- "$stage" "$case_list" <<'REMOTE' || status=$?
set -euo pipefail
stage="$1"
case_list="${2:-}"
[[ "$stage" =~ ^/tmp/pet-quality-[0-9a-f]{40}-[0-9]+$ ]]
[[ "$case_list" =~ ^([a-z0-9-]+(,[a-z0-9-]+)*)?$ ]]
case_args=()
if [[ -n "$case_list" ]]; then
  IFS=',' read -ra selected_cases <<< "$case_list"
  for selected in "${selected_cases[@]}"; do case_args+=(--case "$selected"); done
fi
mapfile -t agents < <(docker ps -q --filter label=com.docker.compose.service=agent)
[[ "${#agents[@]}" == 1 ]]
container="${agents[0]}"
revision="${stage#/tmp/pet-quality-}"
revision="${revision%-*}"
cleanup() {
  if docker exec "$container" test -s "$stage/report.json"; then
    docker exec "$container" cat "$stage/report.json" > "$stage/report.json"
  fi
  docker exec "$container" sh -c 'rm -rf -- "$1"' sh "$stage" || true
}
trap cleanup EXIT
docker exec "$container" mkdir -p "$stage"
docker exec -i "$container" tar --no-same-owner -xzf - -C "$stage" < "$stage/source.tgz"
docker exec -e "PYTHONPATH=$stage/src" -e PYTHONDONTWRITEBYTECODE=1 \
  -e "EVALUATION_REVISION=$revision" \
  -e LANGSMITH_TRACING=false -e LANGSMITH_TRACING_V2=false \
  "$container" /app/.venv/bin/python -m evaluation.pet_quality \
  --live --model gpt-6-luna --output "$stage/report.json" "${case_args[@]}"
REMOTE
scp "$DEPLOY_USER@$DEPLOY_HOST:$stage/report.json" pet-quality-live.json || status=1
ssh "$DEPLOY_USER@$DEPLOY_HOST" "rm -f -- '$stage/source.tgz' '$stage/report.json'; rmdir -- '$stage'" || true
exit "$status"
