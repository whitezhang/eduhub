#!/bin/bash
# 同步仓根 output/（本机 vite 构建并提交）到 nginx 站点根。服务器上不再 npm/vite。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDUHUB_SRC="${EDUHUB_SRC:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WEB="${WEB:-/www/wwwroot/edu.jsoner.cn}"
OUT="$EDUHUB_SRC/output"

if [[ ! -f "$OUT/index.html" ]]; then
  echo "error: missing $OUT/index.html"
  echo "  本机先: npm run build:client  再 git add output && commit/push"
  exit 1
fi

echo "==> [client] rsync $OUT/ -> $WEB/"
mkdir -p "$WEB"
# 宝塔 .user.ini 常带 chattr +i；--delete 时跳过，避免 rsync code 23
rsync -a --delete \
  --exclude '.user.ini' \
  --exclude '.htaccess' \
  --exclude '.well-known' \
  "$OUT/" "$WEB/"
echo "==> [client] done -> $WEB"
