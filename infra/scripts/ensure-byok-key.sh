#!/usr/bin/env sh
# Provision once in the private deployment environment; never print the key.
set -eu
env_file="$1"
[ -f "$env_file" ] || { echo "deployment environment file missing" >&2; exit 1; }
umask 077
exec 9>"$env_file.byok-lock"
flock -x 9
count=$(grep -c '^APP_BYOK_ENCRYPTION_KEY=' "$env_file" || true)
[ "$count" -le 1 ] || { echo "duplicate BYOK encryption configuration" >&2; exit 1; }
existing=$(sed -n 's/^APP_BYOK_ENCRYPTION_KEY=//p' "$env_file")
if [ -n "$existing" ]; then
    # The canonical representation is exactly 32 bytes of base64, without quotes.
    if ! printf '%s' "$existing" | grep -Eq '^[A-Za-z0-9+/]{43}=$'; then
        echo "invalid BYOK encryption configuration; do not rotate automatically" >&2
        exit 1
    fi
    exit 0
fi
temporary=$(mktemp "$env_file.byok.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM
awk '!/^APP_BYOK_ENCRYPTION_KEY=/' "$env_file" > "$temporary"
printf '\nAPP_BYOK_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" >> "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$env_file"
