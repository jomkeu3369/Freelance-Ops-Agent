#!/usr/bin/env bash
set -euo pipefail

evidence_directory="$1"
shift
mkdir -p "$evidence_directory"
npm run start -- --hostname 127.0.0.1 --port 3100 > "$evidence_directory/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ready=false
for ((attempt=0; attempt<60; attempt++)); do
    if curl --fail --silent --max-time 2 "${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:3100}/" > /dev/null; then
        ready=true
        break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
        break
    fi
    sleep 2
done
if [ "$ready" != true ]; then
    cat "$evidence_directory/server.log"
    exit 1
fi
"$@"
