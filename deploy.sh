#!/usr/bin/env bash
# Deploy to a server with Docker:  [SSH_PORT=22] ./deploy.sh user@host [remote dir, default /opt/stashboard]
# For now (stage 0) it copies the project, builds the image and runs the key check from the server's IP.
set -euo pipefail

HOST="${1:?Usage: [SSH_PORT=22] ./deploy.sh user@host [remote dir]}"
REMOTE_DIR="${2:-/opt/stashboard}"
PORT="${SSH_PORT:-22}"
cd "$(dirname "$0")"

# config.json holds the keys. Run locally, it is uploaded; run from CI (no local copy), the one already on the server is kept.
FILES=(src public assets package.json package-lock.json assets.json Dockerfile docker-compose.yml .dockerignore)
if [[ -f config.json ]]; then
  FILES+=(config.json)
elif ! ssh -p "$PORT" "$HOST" "test -f '$REMOTE_DIR/config.json'"; then
  echo "config.json is missing both here and on the server: cp config.example.json config.json and fill it in"
  exit 1
fi

echo "→ Copying to $HOST:$REMOTE_DIR (port $PORT)"
ssh -p "$PORT" "$HOST" "mkdir -p '$REMOTE_DIR'"
# Drop the old sources first so files deleted from the repository do not linger on the server.
ssh -p "$PORT" "$HOST" "cd '$REMOTE_DIR' 2>/dev/null && rm -rf src public assets"
scp -q -r -P "$PORT" "${FILES[@]}" "$HOST:$REMOTE_DIR/"

echo "→ Building and running the check"
ssh -p "$PORT" "$HOST" REMOTE_DIR="$REMOTE_DIR" bash -s <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"
# Secrets: readable only by the node user (uid 1000) inside the container.
chmod 600 config.json
if ! chown 1000:1000 config.json 2>/dev/null; then
  echo "! Not root: cannot chown config.json to uid 1000, making it world-readable (chmod 644)"
  chmod 644 config.json
fi
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
$DC build
$DC run --rm stashboard
REMOTE
