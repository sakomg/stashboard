#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '%s\n' "$*"; }
fail() {
  printf '! %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install it first: https://docs.docker.com/engine/install/"
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  fail "Docker Compose is missing. Install the compose plugin: https://docs.docker.com/compose/install/"
fi
docker info >/dev/null 2>&1 || fail "Docker is installed but this user cannot use it. Run as root, or add the user to the docker group."

ask() {
  local prompt=$1 pattern=$2 required=$3 answer
  while true; do
    read -r -p "$prompt" answer
    if [[ -z "$answer" && "$required" == no ]]; then
      printf ''
      return
    fi
    if [[ "$answer" =~ $pattern ]]; then
      printf '%s' "$answer"
      return
    fi
    say "  That does not look right. Try again." >&2
  done
}

if [[ ! -f config.json ]]; then
  [[ -t 0 ]] || fail "config.json is missing. Run ./install.sh in a terminal, or copy config.example.json to config.json and fill it in."
  say "Stashboard needs a host name for HTTPS and a few free API keys. Press Enter to skip an optional key."
  say
  domain=$(ask "Host name that points to this server (for example stash.example.duckdns.org): " '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' yes)
  zerion=$(ask "Zerion API key, for EVM and Solana wallets (developers.zerion.io): " '^[A-Za-z0-9_.:+/=-]{8,200}$' no)
  tonapi=$(ask "TonAPI key, for TON wallets (tonconsole.com, optional): " '^[A-Za-z0-9_.:+/=-]{8,200}$' no)
  coingecko=$(ask "CoinGecko demo key, for prices, logos and categories (optional): " '^[A-Za-z0-9_.:+/=-]{8,200}$' no)
  umask 077
  cat >config.json <<JSON
{
  "zerion": { "apiKey": "$zerion" },
  "tonapi": { "apiKey": "$tonapi" },
  "coingecko": { "apiKey": "$coingecko" },
  "domain": "$domain",
  "schedule": { "balancesMinutes": 60, "signalsMinutes": 240 }
}
JSON
  say "✓ Wrote config.json"
fi

domain=$(sed -n 's/.*"domain"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' config.json | head -1)
[[ "$domain" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail "config.json has no valid \"domain\". Set it to the host name of the dashboard."
printf 'DOMAIN=%s\n' "$domain" >.env

if command -v getent >/dev/null 2>&1 && command -v hostname >/dev/null 2>&1; then
  resolved=$(getent ahosts "$domain" | awk '{print $1}' | sort -u | tr '\n' ' ')
  local_ips=" $(hostname -I 2>/dev/null || true) "
  matched=no
  for ip in $resolved; do [[ "$local_ips" == *" $ip "* ]] && matched=yes; done
  if [[ -z "$resolved" ]]; then
    say "! $domain does not resolve yet. HTTPS starts working once it points to this server."
  elif [[ "$matched" == no ]]; then
    say "! $domain points to $resolved, which is not an address of this machine. That is fine behind NAT, otherwise fix the DNS record."
  fi
fi

chmod 600 config.json .env
if [[ "$(id -u)" == 0 ]]; then
  chown 1000:1000 config.json
elif [[ "$(id -u)" != 1000 ]]; then
  say "! Not root: making config.json readable for the container (chmod 644)"
  chmod 644 config.json
fi

say "→ Building"
"${DC[@]}" build --quiet
say "→ Checking the API keys"
"${DC[@]}" run --rm --no-deps -T stashboard src/check.ts </dev/null || say "! The key check reported problems (see above). Continuing."
say "→ Starting"
"${DC[@]}" up -d --remove-orphans

status=starting
for _ in $(seq 1 45); do
  status=$(docker inspect -f '{{.State.Health.Status}}' stashboard 2>/dev/null || echo starting)
  [[ "$status" == healthy ]] && break
  sleep 2
done
if [[ "$status" != healthy ]]; then
  "${DC[@]}" logs --tail=40 stashboard
  fail "The service did not become healthy. The log above says why."
fi

say
say "✓ Stashboard is running at https://$domain"
setup=$("${DC[@]}" logs stashboard 2>/dev/null | grep -F '[setup-code]' | tail -1 || true)
if [[ -n "$setup" ]]; then
  code=$(sed -E 's/.*setup code: ([A-Z0-9-]+).*/\1/' <<<"$setup")
  say "  Create your account at https://$domain/setup with the setup code $code"
  say "  The certificate can take a minute on the first start."
else
  say "  Sign in at https://$domain"
fi
