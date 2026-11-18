#!/usr/bin/env bash
# Runs the GitHub CI checks locally; the global pre-push hook runs it on `git push`.
# Mirrors .github/workflows/ci.yml, job `test`: npm ci, playwright chromium, a Postgres for the store tests,
# test:api, test:e2e.
# CI-only: nothing (no provider keys anywhere: the API tests stub fetch, the e2e servers use mock providers; the
# database tests run against a throwaway local Postgres, never against Neon).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm ci

# Playwright browser: the pinned build if it is installed; else an installed headless shell (CHROMIUM_PATH, read by
# playwright.config.js); only then a download. A plain `playwright install` also deletes browsers no installed
# Playwright version claims, which can pull one from under another repo's running tests.
if [ -z "${CHROMIUM_PATH:-}" ]; then
  pw_missing=$(npx playwright install --dry-run chromium | sed -n 's/^ *Install location: *//p' |
    while read -r d; do [ -e "$d/INSTALLATION_COMPLETE" ] || echo "$d"; done)
  if [ -n "$pw_missing" ]; then
    cache="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"
    [ -d "$cache" ] || cache="$HOME/.cache/ms-playwright"
    found=$(ls -d "$cache"/chromium_headless_shell-*/*/chrome-headless-shell "$cache"/chromium_headless_shell-*/*/headless_shell 2>/dev/null | sort -V | tail -1 || true)
    if [ -n "$found" ]; then export CHROMIUM_PATH="$found"; echo "verify: using installed browser $found"
    else npx playwright install chromium; fi
  fi
fi

# Postgres for the store tests: TEST_DATABASE_URL if given, else a throwaway container
started_pg=""
if [ -z "${TEST_DATABASE_URL:-}" ]; then
  if ! docker info >/dev/null 2>&1; then
    echo "verify: the store tests need a Postgres. Start Docker Desktop, or set TEST_DATABASE_URL to a throwaway database." >&2
    exit 1
  fi
  docker rm -f intake-verify-pg >/dev/null 2>&1 || true
  docker run -d --name intake-verify-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=intake_test -p 127.0.0.1:54330:5432 postgres:17-alpine >/dev/null
  started_pg=1
  trap 'docker rm -f intake-verify-pg >/dev/null 2>&1 || true' EXIT
  for _ in $(seq 1 60); do docker exec intake-verify-pg pg_isready -U postgres -d intake_test >/dev/null 2>&1 && break; sleep 0.5; done
  sleep 1   # the image restarts Postgres once after initialising
  export TEST_DATABASE_URL="postgres://postgres:test@127.0.0.1:54330/intake_test"
fi

echo "== defaults"; node scripts/build_defaults.js --check
echo "== test:api"; npm run --silent test:api
echo "== test:e2e"; CI=1 npm run --silent test:e2e
echo "verify: OK"
