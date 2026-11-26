.PHONY: test rust-test web-test build contract check-contract e2e perf compose-smoke restore-drill

test: rust-test web-test check-contract

rust-test:
	bash ops/tests/rust-postgres.sh

web-test:
	npm --prefix web ci
	npm --prefix web run typecheck
	npm --prefix web test

build:
	npm --prefix web ci
	npm --prefix web run build
	cargo build --locked --release --workspace

contract:
	cargo run --quiet --locked -p patchboard -- openapi > web/src/api/openapi.json
	cd web && ./node_modules/.bin/openapi-typescript src/api/openapi.json -o src/api/generated.ts

check-contract:
	@set -eu; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	cargo run --quiet --locked -p patchboard -- openapi > "$$tmp/openapi.json"; \
	cmp "$$tmp/openapi.json" web/src/api/openapi.json; \
	web/node_modules/.bin/openapi-typescript "$$tmp/openapi.json" -o "$$tmp/generated.ts"; \
	cmp "$$tmp/generated.ts" web/src/api/generated.ts

e2e:
	bash ops/tests/rehearse.sh e2e

perf:
	bash ops/tests/rehearse.sh perf

compose-smoke:
	bash ops/tests/compose-smoke.sh

restore-drill:
	bash ops/tests/restore-drill.sh
