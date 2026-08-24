#!/bin/bash
# 编排：静态 Client + Node API。禁止 git clean（保留 SQLite 与测例）。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export EDUHUB_SRC="${EDUHUB_SRC:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export WEB="${WEB:-/www/wwwroot/edu.jsoner.cn}"
export EDUHUB_ENV="${EDUHUB_ENV:-prod}"
export NODE_ENV="${NODE_ENV:-production}"
SKIP_SERVER="${SKIP_SERVER:-0}"
SKIP_CLIENT="${SKIP_CLIENT:-0}"

echo "==> [deploy] env EDUHUB_ENV=$EDUHUB_ENV NODE_ENV=$NODE_ENV"
echo "==> [deploy] sync $EDUHUB_SRC"
cd "$EDUHUB_SRC"
git fetch --all
# 禁止 git clean：runtime（SQLite/测例）与 seed 都是仓外数据。
# PDF 只在本机 data/cache，不进 git；更新题库用 src/op/sync-gesp.sh（只传 seed JSON）。
git reset --hard origin/main

if [[ "$SKIP_CLIENT" != "1" ]]; then
  bash "$SCRIPT_DIR/deploy-client.sh"
fi
if [[ "$SKIP_SERVER" != "1" ]]; then
  bash "$SCRIPT_DIR/deploy-server.sh"
fi
echo "Deploy done."
