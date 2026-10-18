#!/usr/bin/env bash
set -euo pipefail

: "${SSH_PRIVATE_KEY:?SSH 개인 키가 필요합니다.}"
: "${SSH_HOST_KEY:?서버 호스트 키가 필요합니다.}"
ssh_directory="${SSH_DIRECTORY:-$HOME/.ssh}"
install -m 700 -d "$ssh_directory"
printf '%s\n' "$SSH_PRIVATE_KEY" > "$ssh_directory/id_ed25519"
chmod 600 "$ssh_directory/id_ed25519"
printf '%s\n' "$SSH_HOST_KEY" > "$ssh_directory/known_hosts"
