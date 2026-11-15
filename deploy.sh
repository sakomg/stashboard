#!/usr/bin/env bash
set -euo pipefail

HOST="${1:?Usage: [SSH_PORT=22] ./deploy.sh user@host [remote dir]}"
REMOTE_DIR="${2:-/opt/stashboard}"
PORT="${SSH_PORT:-22}"
cd "$(dirname "$0")"

FILES=(src public assets package.json package-lock.json assets.json config.example.json Dockerfile docker-compose.yml Caddyfile .dockerignore install.sh)
ssh -p "$PORT" "$HOST" "mkdir -p '$REMOTE_DIR'"

if [[ -f config.json ]]; then
  FILES+=(config.json)
elif ! ssh -p "$PORT" "$HOST" "test -f '$REMOTE_DIR/config.json'"; then
  echo "config.json is missing here and on the server. Create it from config.example.json, or run ./install.sh on the server."
  exit 1
fi

echo "→ Copying to $HOST:$REMOTE_DIR (port $PORT)"
ssh -p "$PORT" "$HOST" "cd '$REMOTE_DIR' && rm -rf src public assets"
scp -q -r -P "$PORT" "${FILES[@]}" "$HOST:$REMOTE_DIR/"

ssh -p "$PORT" "$HOST" "cd '$REMOTE_DIR' && bash install.sh </dev/null"
