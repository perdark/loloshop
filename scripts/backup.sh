#!/usr/bin/env bash
# LoloShop nightly backup: Postgres dump + uploads tarball.
# Usage (cron):  0 3 * * *  /path/to/loloshop/scripts/backup.sh >> /var/log/loloshop-backup.log 2>&1
# Requires: DATABASE_URL in env (or backend/.env), and optional BACKUP_DIR / retention.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Load DATABASE_URL from backend/.env if not already set.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/backend/.env" ]; then
  export "$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | head -1)"
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "FATAL: DATABASE_URL not set" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] dumping database..."
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[$(date -Is)] archiving uploads..."
if [ -d "$ROOT/uploads" ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$ROOT" uploads
fi

# Optional offsite copy: set S3_DEST=s3://bucket/path and have aws cli configured.
if [ -n "${S3_DEST:-}" ]; then
  echo "[$(date -Is)] uploading to $S3_DEST..."
  aws s3 cp "$BACKUP_DIR/db-$STAMP.sql.gz" "$S3_DEST/"
  [ -f "$BACKUP_DIR/uploads-$STAMP.tar.gz" ] && aws s3 cp "$BACKUP_DIR/uploads-$STAMP.tar.gz" "$S3_DEST/"
fi

echo "[$(date -Is)] pruning backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[$(date -Is)] backup complete."
