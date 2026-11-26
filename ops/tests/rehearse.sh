#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
work=$(mktemp -d)
source_project=kiska_smoke_$(date +%s)_$$
target_project=${source_project}_restore
export KISKA_IMAGE=kiska:"$source_project"
export KISKA_OPS_IMAGE=kiska-ops:"$source_project"
export COMPOSE_PROJECT_NAME=$source_project COMPOSE_FILE=compose.yaml:compose.dev.yaml
export COMPOSE_ENV_FILES="$work/env"
cleanup() {
  for project in "$source_project" "$target_project"; do
    COMPOSE_PROJECT_NAME=$project docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  done
  docker image rm "$KISKA_IMAGE" "$KISKA_OPS_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# Keep concurrent drills from reserving the same host ports or proxy subnet while images build.
exec {startup_lock}>"${XDG_RUNTIME_DIR:-/tmp}/kiska-bootstrap-$(id -u).lock"
flock "$startup_lock"
python3 - "$work/env" <<'PY'
import ipaddress, json, secrets, socket, subprocess, sys
from pathlib import Path
ids = subprocess.check_output(["docker", "network", "ls", "-q"], text=True).split()
networks = json.loads(subprocess.check_output(["docker", "network", "inspect", *ids]))
used = [ipaddress.ip_network(c["Subnet"]) for n in networks for c in (n["IPAM"]["Config"] or []) if c.get("Subnet")]
net = secrets.choice([n for n in ipaddress.ip_network("10.199.0.0/16").subnets(new_prefix=24) if all(not n.overlaps(u) for u in used if u.version == 4)])
with socket.socket() as a, socket.socket() as b:
    a.bind(("127.0.0.1", 0)); b.bind(("127.0.0.1", 0))
    port, inbox = a.getsockname()[1], b.getsockname()[1]
values = dict(PUBLIC_ORIGIN=f"http://127.0.0.1:{port}", HTTP_PORT=port, INBOX_PORT=inbox,
              SMTP_HOST="inbox", SMTP_FROM="kiska@example.test", S3_GRANT_SECONDS=3,
              PROXY_SUBNET=net, PROXY_IP=net[10], HTTPS_PROXY_IP=net[1])
for key in ("POSTGRES_PASSWORD","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","IP_HASH_KEY"):
    values[key] = secrets.token_hex(32)
Path(sys.argv[1]).write_text("".join(f"{k}={v}\n" for k,v in values.items()))
PY
# Load the generated test-only values even if the host shell already has production settings.
set -a
# shellcheck source=/dev/null
source "$work/env"
set +a
if [[ $1 == e2e || $1 == perf ]]; then
  export COMPOSE_FILE="$COMPOSE_FILE:$work/browser.yaml"
  cat >"$work/browser.yaml" <<'YAML'
x-database: &database
  DATABASE_URL: postgres://kiska:${POSTGRES_PASSWORD}@db:5432/kiska_perf
services:
  db:
    environment: {POSTGRES_DB: kiska_perf}
    ports: ["127.0.0.1::5432"]
  app:
    environment: *database
  migrate:
    environment: *database
  worker:
    environment: *database
YAML
fi
docker compose build app ops
docker compose up -d --wait --no-build
flock -u "$startup_lock"
if [[ $1 == e2e || $1 == perf ]]; then
  export KISKA_URL="$PUBLIC_ORIGIN" KISKA_INBOX_URL="http://127.0.0.1:$INBOX_PORT"
  export PERF_DATABASE_URL="postgres://kiska:$POSTGRES_PASSWORD@$(docker compose port db 5432)/kiska_perf"
  if [[ ! -x web/node_modules/.bin/playwright ]]; then npm --prefix web ci; fi
  if [[ $1 == perf ]]; then
    export PERF_IMAGE_ID
    PERF_IMAGE_ID=$(docker image inspect --format "{{.Id}}" "$KISKA_IMAGE")
    bash web/perf/run.sh
  else
    PERF_ARTIFACTS="$work/fixture" node web/perf/seed.mjs
    export KISKA_OPERATOR_EMAIL="test-operator@kiska.invalid"
    KISKA_OPERATOR_PASSWORD=$(python3 -c 'import secrets;print(secrets.token_hex(24))')
    export KISKA_OPERATOR_PASSWORD
    python3 - <<'PYTHON'
import json, os, urllib.request
data = {"name":"Test operator","email":os.environ["KISKA_OPERATOR_EMAIL"],"password":os.environ["KISKA_OPERATOR_PASSWORD"]}
request = urllib.request.Request(os.environ["KISKA_URL"]+"/api/v1/auth/register",
    data=json.dumps(data).encode(),headers={"Content-Type":"application/json","X-Kiska":"1"})
with urllib.request.urlopen(request) as response:
    assert response.status==200
PYTHON
    docker compose exec -T db psql -U kiska -d kiska_perf -v ON_ERROR_STOP=1 -qc "UPDATE accounts SET verified=true WHERE email='test-operator@kiska.invalid'"
    docker compose run --rm --no-deps app operator "$KISKA_OPERATOR_EMAIL"
    npm --prefix web run test:e2e
  fi
  exit
fi
python3 ops/tests/lifecycle.py seed "$work/state.json"
python3 ops/tests/lifecycle.py faults "$work/state.json"
docker compose stop app worker proxy
docker compose exec -T db psql -U kiska -v ON_ERROR_STOP=1 -q -c "INSERT INTO outbox(email,subject,body,next_try) VALUES('queue@example.test','restore-marker','mail job retained',now()+interval '1 day')"
docker compose restart db storage
docker compose up -d --wait --no-build
python3 ops/tests/lifecycle.py check "$work/state.json"
queued() {
  test "$(docker compose exec -T db psql -U kiska -Atqc "SELECT count(*) FROM outbox WHERE subject='restore-marker'")" = 1
}
queued
echo "Fresh stack, published and pending image visibility, SMTP and persistence passed."
if [[ $1 == restore ]]; then
  ops/backup/run.sh "$work/backup"
  docker compose down
  export COMPOSE_PROJECT_NAME=$target_project
  ops/restore/run.sh "$work/backup"
  docker compose up -d --wait --no-build
  python3 ops/tests/lifecycle.py check "$work/state.json"
  queued
  echo "Restore to fresh PostgreSQL and SeaweedFS volumes passed."
fi
