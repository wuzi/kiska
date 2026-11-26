#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${PATCHBOARD_TEST_DATABASE_URL:-}" ]]; then
    DATABASE_URL="$PATCHBOARD_TEST_DATABASE_URL" cargo test --locked --workspace "$@"
    exit
fi
container=$(docker run --detach --rm -e POSTGRES_PASSWORD=local-test --publish 127.0.0.1::5432 postgres:17)
trap 'docker stop "$container" >/dev/null' EXIT
for attempt in {1..45}; do
    if docker exec "$container" pg_isready -U postgres >/dev/null; then break; fi
    sleep 1
done
port=$(docker port "$container" 5432/tcp)
DATABASE_URL="postgres://postgres:local-test@${port}/postgres" cargo test --locked --workspace "$@"
