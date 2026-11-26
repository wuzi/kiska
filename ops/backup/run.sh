#!/usr/bin/env bash
set -euo pipefail
umask 077
dest=${1:?usage: ops/backup/run.sh NEW_BACKUP_DIRECTORY}
mkdir -m 700 "$dest"
dest=$(realpath "$dest")
docker compose build ops
# Stop every app-owned writer and remember which services were running.
mapfile -t running < <(docker compose ps --status running --services | grep -Ex 'app|worker' || true)
resume() { if ((${#running[@]})); then docker compose start "${running[@]}"; fi; }
trap resume EXIT
docker compose stop app worker
docker compose run --no-deps --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$dest:/backup:Z" ops capture.sh
