#!/usr/bin/env sh
set -eu
repository_root=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
env_file="$temporary/.env"
printf 'EXISTING_SETTING=keep\nAPP_BYOK_ENCRYPTION_KEY=\n' > "$env_file"
sh "$repository_root/infra/scripts/ensure-byok-key.sh" "$env_file" > "$temporary/output"
[ ! -s "$temporary/output" ]
first_checksum=$(sha256sum "$env_file")
sh "$repository_root/infra/scripts/ensure-byok-key.sh" "$env_file" > "$temporary/output"
[ "$first_checksum" = "$(sha256sum "$env_file")" ]
grep -q '^EXISTING_SETTING=keep$' "$env_file"
[ "$(sed -n 's/^APP_BYOK_ENCRYPTION_KEY=//p' "$env_file" | openssl base64 -d | wc -c | tr -d ' ')" = 32 ]
[ "$(stat -c '%a' "$env_file")" = 600 ]
printf 'APP_BYOK_ENCRYPTION_KEY=invalid-existing\n' > "$env_file"
if sh "$repository_root/infra/scripts/ensure-byok-key.sh" "$env_file" > "$temporary/output" 2>&1; then
    echo "FAIL: invalid existing key was accepted" >&2
    exit 1
fi
grep -q '^APP_BYOK_ENCRYPTION_KEY=invalid-existing$' "$env_file"
if grep -q 'invalid-existing' "$temporary/output"; then
    echo "FAIL: invalid key was disclosed" >&2
    exit 1
fi

printf 'APP_BYOK_ENCRYPTION_KEY=\nAPP_BYOK_ENCRYPTION_KEY=\n' > "$env_file"
duplicate_checksum=$(sha256sum "$env_file")
if sh "$repository_root/infra/scripts/ensure-byok-key.sh" "$env_file" > "$temporary/output" 2>&1; then
    echo "FAIL: duplicate keys were accepted" >&2
    exit 1
fi
[ "$duplicate_checksum" = "$(sha256sum "$env_file")" ]
grep -q 'duplicate BYOK encryption configuration' "$temporary/output"
printf 'BYOK provisioning: create, preserve, permissions, no disclosure, invalid and duplicate-key refusal passed\n'
