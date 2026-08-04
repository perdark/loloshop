#!/usr/bin/env bash
# LoloShop backup — database (+ optionally uploads).
#
#   scripts/backup-full.sh                  # back up PROD over SSH (default)
#   scripts/backup-full.sh --local          # back up the laptop dev DB
#   scripts/backup-full.sh --uploads /mnt/usb   # also pull prod uploads (~4.4 GB)
#
# NOTE ON pg_dump VERSIONS: the distro pg_dump is 16 and REFUSES a v17 server
# ("aborting because of server version mismatch"). A portable 17 client lives at
# ~/.local/opt/pg17/bin — this script requires it rather than falling back to a
# CSV export, so backups stay real pg_restore archives.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="${BACKUP_DIR:-$HOME/Desktop/clients/loloshop-db-backups}"
PROD_HOST="${PROD_HOST:-root@142.93.110.202}"

PG17="$HOME/.local/opt/pg17/bin"
if [ -x "$PG17/pg_dump" ]; then
  export PATH="$PG17:$PATH"
else
  echo "FATAL: need PostgreSQL 17 client at $PG17 (distro pg_dump 16 refuses a v17 server)." >&2
  exit 1
fi

MODE=prod
UPLOADS_DEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --local)   MODE=local ;;
    --prod)    MODE=prod ;;
    --uploads) UPLOADS_DEST="${2:?--uploads needs a destination directory}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

mkdir -p "$OUT"

# ---------- database ----------
if [ "$MODE" = prod ]; then
  DUMP="$OUT/loloshop-prod-$STAMP.dump"
  echo "[$(date -Is)] dumping PROD via $PROD_HOST (streamed — uses no disk on the server)..."
  # -Fc custom format: compressed and restorable table-by-table with pg_restore.
  ssh -o BatchMode=yes "$PROD_HOST" \
    'sudo -u postgres pg_dump -Fc --no-owner --no-acl loloshop' > "$DUMP"
else
  DUMP="$OUT/loloshop-dev-$STAMP.dump"
  [ -f "$ROOT/backend/.env" ] && export "$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | head -1)"
  [ -z "${DATABASE_URL:-}" ] && { echo "FATAL: DATABASE_URL not set" >&2; exit 1; }
  echo "[$(date -Is)] dumping LOCAL dev DB..."
  pg_dump -Fc --no-owner --no-acl "$DATABASE_URL" > "$DUMP"
fi

# ---------- verify the archive is actually readable ----------
# An unreadable dump that nobody opened until restore day is the classic failure.
if pg_restore --list "$DUMP" >/dev/null 2>&1; then
  TABLES="$(pg_restore --list "$DUMP" | grep -c 'TABLE DATA' || true)"
  echo "[$(date -Is)] OK  $(basename "$DUMP")  $(du -h "$DUMP" | cut -f1)  ${TABLES} tables with data"
else
  echo "FATAL: $DUMP is not a readable pg_restore archive" >&2
  exit 1
fi

# ---------- uploads (opt-in: ~4.4 GB, will not fit on the laptop) ----------
if [ -n "$UPLOADS_DEST" ]; then
  mkdir -p "$UPLOADS_DEST"
  AVAIL_KB="$(df -Pk "$UPLOADS_DEST" | awk 'NR==2{print $4}')"
  NEED_KB="$(ssh -o BatchMode=yes "$PROD_HOST" 'du -sk /var/www/loloshop/uploads' | cut -f1)"
  echo "[$(date -Is)] uploads need $((NEED_KB/1024)) MB; $UPLOADS_DEST has $((AVAIL_KB/1024)) MB free"
  if [ "$AVAIL_KB" -lt "$((NEED_KB + 512000))" ]; then
    echo "FATAL: not enough free space at $UPLOADS_DEST" >&2; exit 1
  fi
  echo "[$(date -Is)] pulling uploads..."
  rsync -a --info=progress2 "$PROD_HOST:/var/www/loloshop/uploads/" "$UPLOADS_DEST/uploads/"
  echo "[$(date -Is)] uploads done: $(du -sh "$UPLOADS_DEST/uploads" | cut -f1)"
fi

echo "[$(date -Is)] backup complete -> $OUT"
