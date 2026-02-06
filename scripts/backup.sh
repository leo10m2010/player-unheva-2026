#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d_%H%M%S)"
ARCHIVE="$BACKUP_DIR/player_backup_${STAMP}.tar.gz"

tar -czf "$ARCHIVE" \
  -C "$ROOT_DIR" \
  data uploads thumbnails hls docker-compose.yml README.md

find "$BACKUP_DIR" -type f -name "player_backup_*.tar.gz" -mtime +"$RETENTION_DAYS" -delete

echo "Backup creado: $ARCHIVE"
