#!/usr/bin/env bash
set -euo pipefail

HOST="${1:?Usage: [SSH_PORT=22] ./deploy.sh user@host [remote dir]}"
REMOTE_DIR="${2:-/opt/stashboard}"
PORT="${SSH_PORT:-22}"
cd "$(dirname "$0")"

FILES=(src public assets package.json package-lock.json assets.json Dockerfile docker-compose.yml Caddyfile .dockerignore)
ssh -p "$PORT" "$HOST" "mkdir -p '$REMOTE_DIR'"

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
ssh -p "$PORT" "$HOST" "cd '$REMOTE_DIR' && rm -rf src public assets"
scp -q -r -P "$PORT" "${FILES[@]}" "$HOST:$REMOTE_DIR/"

echo "→ Building, checking and starting"
ssh -p "$PORT" "$HOST" REMOTE_DIR="$REMOTE_DIR" bash -s <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"
chmod 600 config.json .env
if ! chown 1000:1000 config.json 2>/dev/null; then
  echo "! Not root: cannot chown config.json to uid 1000, making it world-readable (chmod 644)"
  chmod 644 config.json
fi
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
$DC build --quiet
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
if setup=$($DC logs --since 2m stashboard 2>/dev/null | grep -F '[setup-code]' | tail -1) && [[ -n "$setup" ]]; then
  echo
  echo "$setup" | sed -E 's/^[^|]*\| //; s/ +\[setup-code\]//'
fi
REMOTE
