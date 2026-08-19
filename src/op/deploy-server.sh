#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDUHUB_SRC="${EDUHUB_SRC:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
API_SERVICE="${API_SERVICE:-eduhub-api}"
API_PORT="${API_PORT:-8081}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${API_PORT}/api/health}"

echo "==> [server] npm ci"
cd "$EDUHUB_SRC"
npm ci --omit=dev

echo "==> [server] apply catalog"
node src/op/apply-catalog.mjs

if ! command -v systemctl >/dev/null 2>&1; then
  echo "error: systemctl not found"
  exit 1
fi
if ! systemctl cat "$API_SERVICE" &>/dev/null; then
  echo "error: systemd unit $API_SERVICE 未安装。在服务器执行一次："
  echo "  cp $EDUHUB_SRC/src/op/eduhub-api.service /etc/systemd/system/"
  echo "  systemctl daemon-reload && systemctl enable --now $API_SERVICE"
  exit 1
fi

echo "==> [server] restart $API_SERVICE"
systemctl restart "$API_SERVICE"
ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "$HEALTH_URL" >/dev/null; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  echo "error: health check failed"
  systemctl --no-pager --full status "$API_SERVICE" || true
  exit 1
fi
echo "==> [server] done"
