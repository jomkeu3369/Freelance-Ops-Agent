#!/bin/sh
set -eu

uv run --no-dev alembic upgrade head
exec "$@"
