#!/usr/bin/env bash
# Run this on the VPS — pulls latest main, rebuilds, reloads PM2.
# Usage: bash scripts/deploy.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "==> git fetch + reset"
git fetch origin
git reset --hard origin/main

echo "==> backend: install deps"
cd backend && npm ci --omit=dev && cd ..

echo "==> db: apply schema (idempotent)"
cd backend && NODE_ENV=production npm run migrate && cd ..

echo "==> frontend: install + build"
# ⚠️ `rm -rf .next` is not tidiness. On 2026-08-29 the build died with
#   ENOTEMPTY: rmdir '.next/server/app/index.segments/!KHN0dWRlbnQp'
# — a stale artifact from the previous build that Next could not clear. Because the `git reset
# --hard` above has ALREADY run by then, the box's `git log` read as deployed while the served
# frontend was two commits old, and it stayed that way for two days with nothing on any screen
# saying so. A cold build costs ~90s; a silently stale frontend costs whatever it costs.
cd frontend && rm -rf .next && npm ci && npm run build && cd ..

echo "==> PM2 reload"
pm2 reload ecosystem.config.js --update-env

echo "==> Done. $(date)"
