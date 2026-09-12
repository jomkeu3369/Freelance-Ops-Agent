#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
env_file="$temporary/.env"
printf 'EXISTING_SETTING=keep\nAPP_BYOK_ENCRYPTION_KEY=\n' > "$env_file"
sh "$root/infra/scripts/ensure-byok-key.sh" "$env_file" > "$temporary/output"
[ ! -s "$temporary/output" ]
first=$(sha256sum "$env_file")
sh "$root/infra/scripts/ensure-byok-key.sh" "$env_file" > "$temporary/output"
[ "$first" = "$(sha256sum "$env_file")" ]
grep -q '^EXISTING_SETTING=keep$' "$env_file"
[ "$(sed -n 's/^APP_BYOK_ENCRYPTION_KEY=//p' "$env_file" | openssl base64 -d | wc -c | tr -d ' ')" = 32 ]
[ "$(stat -c '%a' "$env_file")" = 600 ]
printf 'APP_BYOK_ENCRYPTION_KEY=invalid-existing\n' > "$env_file"
if sh "$root/infra/scripts/ensure-byok-key.sh" "$env_file" > "$temporary/output" 2>&1; then exit 1; fi
grep -q '^APP_BYOK_ENCRYPTION_KEY=invalid-existing$' "$env_file"
! grep -q 'invalid-existing' "$temporary/output"
printf 'BYOK provisioning: create, preserve, permissions, no disclosure, invalid-key refusal passed\n'
