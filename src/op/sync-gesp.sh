#!/bin/bash
# 把本机解析好的 GESP JSON 推到云主机并导入 SQLite。
# 不同步 PDF（约 200MB）。parsed JSON 大约 3MB。
#
# 本机（Git Bash）:
#   EDUHUB_REMOTE=root@1.2.3.4 EDUHUB_REMOTE_ROOT=/root/deploy/eduhub bash src/op/sync-gesp.sh
#
# 若 JSON 已经在服务器上，只导入:
#   SKIP_PUSH=1 bash src/op/sync-gesp.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCAL_JSON="$ROOT/src/rd/server/data/seed/gesp"
REMOTE="${EDUHUB_REMOTE:-}"
REMOTE_ROOT="${EDUHUB_REMOTE_ROOT:-/root/deploy/eduhub}"
REMOTE_JSON="$REMOTE_ROOT/src/rd/server/data/seed/gesp"
SKIP_PUSH="${SKIP_PUSH:-0}"

if [[ "$SKIP_PUSH" != "1" ]]; then
  if [[ -z "$REMOTE" ]]; then
    echo "error: set EDUHUB_REMOTE=user@host  (or SKIP_PUSH=1 to import locally/on-server)"
    exit 1
  fi
  if [[ ! -d "$LOCAL_JSON" ]]; then
    echo "error: missing $LOCAL_JSON  (先在本机运行 python src/op/gesp_import.py --no-import)"
    exit 1
  fi
  echo "==> push parsed JSON -> $REMOTE:$REMOTE_JSON"
  ssh "$REMOTE" "mkdir -p '$REMOTE_JSON'"
  rsync -az --delete --include='*.json' --exclude='*' "$LOCAL_JSON/" "$REMOTE:$REMOTE_JSON/"
  echo "==> import on remote"
  ssh "$REMOTE" "cd '$REMOTE_ROOT' && EDUHUB_ENV=prod NODE_ENV=production python3 src/op/gesp_import.py --skip-crawl"
else
  echo "==> import locally (JSON only, no PDF)"
  cd "$ROOT"
  EDUHUB_ENV="${EDUHUB_ENV:-prod}" NODE_ENV="${NODE_ENV:-production}" python3 src/op/gesp_import.py --skip-crawl
fi
echo "sync-gesp done."
