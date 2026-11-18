#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${STUDIO_HUB_PORT:-4400}"
URL="http://localhost:${PORT}"

echo "==================================================="
echo "  HyperFrames Video Studio (${URL})"
echo "==================================================="

open_browser() {
  local target_url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$target_url" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$target_url" >/dev/null 2>&1 || true
  fi
}

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${PORT}" 2>/dev/null | grep -q ":${PORT}"
    return $?
  fi
  return 1
}

if [ ! -f "studio-hub/public/app.js" ]; then
  echo "Building React 19 Studio UI bundle..."
  node studio-hub/build-ui.mjs
fi

if port_in_use; then
  echo "Studio Hub is already running on port ${PORT}. Opening browser..."
  open_browser "$URL"
  exit 0
fi

echo "Starting Studio Hub server..."
(
  sleep 1.5
  open_browser "$URL"
) &

exec node studio-hub/server.mjs
