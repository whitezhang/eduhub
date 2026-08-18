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
rsync -a --delete "$EDUHUB_SRC/src/rd/client/dist/" "$WEB/"
echo "==> [client] done -> $WEB"
