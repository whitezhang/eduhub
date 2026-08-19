#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDUHUB_SRC="${EDUHUB_SRC:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WEB="${WEB:-/www/wwwroot/edu.jsoner.cn}"

echo "==> [client] vite build"
cd "$EDUHUB_SRC"
npm ci
npm run build:client
mkdir -p "$WEB"
# 宝塔会在站点根放不可删的 .user.ini（常带 chattr +i）；--delete 时跳过，避免 rsync code 23
rsync -a --delete \
  --exclude '.user.ini' \
  --exclude '.htaccess' \
  --exclude '.well-known' \
  "$EDUHUB_SRC/src/rd/client/dist/" "$WEB/"
echo "==> [client] done -> $WEB"
