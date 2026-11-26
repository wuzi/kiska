#!/usr/bin/env bash
set -euo pipefail
: "${COMPOSE_PROJECT_NAME:?set a separate Compose project name for the fresh restore target}"
dir=$(realpath "${1:?usage: ops/restore/run.sh BACKUP_DIRECTORY}")
test -f "$dir/snapshot.sha256"
if docker compose ps --status running --services | grep -Eq '^(app|worker|migrate)$'; then
  echo "Restore requires a fresh project with application writers stopped" >&2
  exit 1
fi
docker compose build ops
docker compose up -d --wait db storage
docker compose run --no-deps --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$dir:/backup:ro,Z" ops import.sh
