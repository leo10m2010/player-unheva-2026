#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://localhost:8090/api/health}"
TIMEOUT="${TIMEOUT:-8}"

if ! PAYLOAD="$(curl -fsS --max-time "$TIMEOUT" "$HEALTH_URL")"; then
  echo "[health-monitor] error: no se pudo consultar $HEALTH_URL"
  exit 1
fi

STATUS="$(printf '%s' "$PAYLOAD" | node -e 'let body=""; process.stdin.on("data", d => body += d); process.stdin.on("end", () => { try { const parsed = JSON.parse(body); process.stdout.write(String(parsed.status || "")); } catch { process.stdout.write(""); } });')"

if [[ "$STATUS" != "ok" ]]; then
  echo "[health-monitor] error: status inesperado ($STATUS)"
  exit 1
fi

echo "[health-monitor] ok"
