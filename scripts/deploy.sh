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
cd backend && npm run migrate && cd ..

echo "==> frontend: install + build"
cd frontend && npm ci && npm run build && cd ..

echo "==> PM2 reload"
pm2 reload ecosystem.config.js --update-env

echo "==> Done. $(date)"
