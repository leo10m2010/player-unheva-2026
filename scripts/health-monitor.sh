#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://localhost:8090/api/health}"
TIMEOUT="${TIMEOUT:-8}"

if ! PAYLOAD="$(curl -fsS --max-time "$TIMEOUT" "$HEALTH_URL")"; then
  echo "[health-monitor] error: no se pudo consultar $HEALTH_URL"
  exit 1
fi

STATUS="$(printf '%s' "$PAYLOAD" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"

if [[ "$STATUS" != "ok" ]]; then
  echo "[health-monitor] error: status inesperado ($STATUS)"
  exit 1
fi

echo "[health-monitor] ok"
