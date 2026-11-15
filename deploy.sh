#!/usr/bin/env bash
# Deploy to a server with Docker:  [SSH_PORT=22] ./deploy.sh user@host [remote dir, default /opt/stashboard]
# Copies the project, builds the image, checks the API keys from the server, then (re)starts the service.
set -euo pipefail

HOST="${1:?Usage: [SSH_PORT=22] ./deploy.sh user@host [remote dir]}"
REMOTE_DIR="${2:-/opt/stashboard}"
PORT="${SSH_PORT:-22}"
cd "$(dirname "$0")"

FILES=(src public assets package.json package-lock.json assets.json Dockerfile docker-compose.yml Caddyfile .dockerignore)
ssh -p "$PORT" "$HOST" "mkdir -p '$REMOTE_DIR'"

# config.json holds the keys and the domain. Run locally, it is uploaded together with a .env
# naming the domain; run from CI (no local copy), what is already on the server is kept.
if [[ -f config.json ]]; then
  node -e '
    const c = JSON.parse(require("fs").readFileSync("config.json", "utf8"));
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(c.domain ?? "")) {
      console.error("config.json has no domain: set \"domain\" to the host name of the dashboard");
      process.exit(1);
    }
    require("fs").writeFileSync(".env.deploy", `DOMAIN=${c.domain}\n`);
  '
  trap 'rm -f .env.deploy' EXIT
  scp -q -P "$PORT" .env.deploy "$HOST:$REMOTE_DIR/.env"
  FILES+=(config.json)
elif ! ssh -p "$PORT" "$HOST" "test -f '$REMOTE_DIR/config.json' -a -f '$REMOTE_DIR/.env'"; then
  echo "config.json is missing here, and the server has no config.json and .env yet: run ./deploy.sh once from a machine that has config.json"
  exit 1
fi

echo "→ Copying to $HOST:$REMOTE_DIR (port $PORT)"
# Drop the old sources first so files deleted from the repository do not linger on the server.
ssh -p "$PORT" "$HOST" "cd '$REMOTE_DIR' && rm -rf src public assets"
scp -q -r -P "$PORT" "${FILES[@]}" "$HOST:$REMOTE_DIR/"

echo "→ Building, checking and starting"
ssh -p "$PORT" "$HOST" REMOTE_DIR="$REMOTE_DIR" bash -s <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"
# Secrets: readable only by the node user (uid 1000) inside the container.
chmod 600 config.json .env
if ! chown 1000:1000 config.json 2>/dev/null; then
  echo "! Not root: cannot chown config.json to uid 1000, making it world-readable (chmod 644)"
  chmod 644 config.json
fi
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
$DC build --quiet
# The key check runs in a throwaway container first. A failing source is reported but does not stop
# the deploy: a third-party outage must not block shipping a fix.
# </dev/null: this script itself arrives on stdin, and the container must not read the rest of it.
$DC run --rm --no-deps -T stashboard src/check.ts </dev/null || echo "! The key check reported problems (see above); continuing"
$DC up -d --remove-orphans

echo "→ Waiting for the service"
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' stashboard 2>/dev/null || echo starting)
  [[ "$status" == healthy ]] && break
  sleep 2
done
$DC ps
if [[ "$status" != healthy ]]; then
  echo "! The service did not become healthy:"
  $DC logs --tail=30 stashboard
  exit 1
fi
echo "✓ Running at https://$(grep -oP '(?<=^DOMAIN=).*' .env)"
# Until the owner has created the account, the server prints a setup code on every start.
if setup=$($DC logs --since 2m stashboard 2>/dev/null | grep -F '[setup-code]' | tail -1) && [[ -n "$setup" ]]; then
  echo
  echo "$setup" | sed -E 's/^[^|]*\| //; s/ +\[setup-code\]//'
fi
REMOTE
