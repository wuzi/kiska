#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PERF_DATABASE_URL:?set PERF_DATABASE_URL to a migrated dedicated perf database}"
: "${PATCHBOARD_URL:?set PATCHBOARD_URL to the corresponding production application}"
export PERF_ARTIFACTS="${PERF_ARTIFACTS:-$(pwd)/../artifacts/perf}"
export PERF_SESSION_FILE
PERF_SESSION_FILE=$(mktemp)
trap 'rm -f "$PERF_SESSION_FILE"' EXIT
node perf/seed.mjs
PERF_SESSION="$(cat "$PERF_SESSION_FILE")" node perf/measure.mjs
