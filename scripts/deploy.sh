#!/usr/bin/env bash
# Run this on the VPS — pulls latest main, rebuilds, reloads PM2.
# Usage: bash scripts/deploy.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "==> git pull"
git pull origin main

echo "==> backend: install deps"
cd backend && npm ci --omit=dev && cd ..

echo "==> frontend: install + build"
cd frontend && npm ci && npm run build && cd ..

echo "==> PM2 reload"
pm2 reload ecosystem.config.js --update-env

echo "==> Done. $(date)"
