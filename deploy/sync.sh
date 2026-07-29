#!/usr/bin/env bash
# Sync the agora source tree to a server and (re)build there. For a deploy that
# is not a git clone — the app tree stays a plain rsync copy.
#
# Usage: deploy/sync.sh user@host [remote-dir]
#   remote-dir defaults to apps/agora, relative to the remote home.
set -euo pipefail

HOST="${1:?usage: sync.sh user@host [remote-dir]}"
REMOTE_DIR="${2:-apps/agora}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
# rsync --delete (not tar): files removed from the source must disappear from
# the app tree too, or stale .ts files break the next build there
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude data \
  ./ "$HOST":"$REMOTE_DIR"/

ssh "$HOST" "cd ~/$REMOTE_DIR && npm install --no-fund --no-audit && npm run build && install -Dm755 cli/agora ~/.local/bin/agora && ln -sf ~/.local/bin/agora ~/.local/bin/agora && install -Dm755 deploy/xclip ~/.local/bin/xclip"
echo "synced + built on $HOST:$REMOTE_DIR"
