#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_NAME="${PROJECT_NAME:-player}"

echo "[deploy] proyecto: $PROJECT_NAME"
echo "[deploy] directorio: $PROJECT_DIR"

cd "$PROJECT_DIR"
docker compose -p "$PROJECT_NAME" up -d --build
docker compose -p "$PROJECT_NAME" ps

echo "[deploy] listo"
