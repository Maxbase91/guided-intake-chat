#!/usr/bin/env bash
# Runs the GitHub CI checks locally; the global pre-push hook runs it on `git push`.
# Mirrors .github/workflows/ci.yml, job `test`: npm ci, playwright chromium, test:api, test:e2e.
# CI-only: nothing (no provider keys anywhere: the API tests stub fetch, the e2e servers use mock
# providers).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm ci
# Playwright browsers: install only when missing. A plain `playwright install` also deletes browsers
# no installed Playwright version claims, which can pull one from under another repo's running tests.
pw_missing=$(npx playwright install --dry-run chromium | sed -n 's/^ *Install location: *//p' |
  while read -r d; do [ -e "$d/INSTALLATION_COMPLETE" ] || echo "$d"; done)
[ -z "$pw_missing" ] || npx playwright install chromium

echo "== test:api"; npm run --silent test:api
echo "== test:e2e"; CI=1 npm run --silent test:e2e
echo "verify: OK"
