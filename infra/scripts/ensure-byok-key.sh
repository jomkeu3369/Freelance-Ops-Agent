#!/usr/bin/env sh
# 서버의 환경 파일에 키를 한 번만 생성하며 키 값은 출력하지 않는다.
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: ensure-byok-key.sh <environment-file>" >&2
    exit 2
fi

env_file="$1"
if [ ! -f "$env_file" ]; then
    echo "deployment environment file missing" >&2
    exit 1
fi

umask 077
exec 9>"$env_file.byok-lock"
flock -x 9
key_count=$(grep -c '^APP_BYOK_ENCRYPTION_KEY=' "$env_file" || true)
if [ "$key_count" -gt 1 ]; then
    echo "duplicate BYOK encryption configuration" >&2
    exit 1
fi

existing_key=$(sed -n 's/^APP_BYOK_ENCRYPTION_KEY=//p' "$env_file")
if [ -n "$existing_key" ]; then
    # 키는 따옴표 없이 32바이트를 Base64로 인코딩한 형식만 허용한다.
    if ! printf '%s' "$existing_key" | grep -Eq '^[A-Za-z0-9+/]{43}=$'; then
        echo "invalid BYOK encryption configuration; do not rotate automatically" >&2
        exit 1
    fi
    exit 0
fi
temporary_file=$(mktemp "$env_file.byok.XXXXXX")
trap 'rm -f "$temporary_file"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
awk '!/^APP_BYOK_ENCRYPTION_KEY=/' "$env_file" > "$temporary_file"
printf '\nAPP_BYOK_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" >> "$temporary_file"
chmod 600 "$temporary_file"
mv "$temporary_file" "$env_file"
