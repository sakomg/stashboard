<p><img src="assets/logo-wordmark.svg" alt="Stashboard" height="56"></p>

**Your whole stash on one board.** A self-hosted, read-only portfolio dashboard for people whose money is
spread across an exchange, several chains and a handful of DeFi protocols.

Stashboard pulls balances from Binance, EVM chains, Solana and TON into one net-worth view, shows how the
portfolio is allocated, keeps its history, and scores every position from cold to overheated so you can see
what to trim and what to leave alone.

> **Status:** working end to end: collection, dashboard, signals, login and a one-command deploy.
> See [PLAN.md](PLAN.md).

## Principles

- **Read-only.** A read-only exchange key and public wallet addresses. No seed phrases, no signatures, no trading.
- **Yours.** One SQLite file on your own server. Nothing is sent to third-party trackers.
- **Free.** Every data source works on a free tier. No paid APIs, ever.
- **Small.** One container, one database file, a frontend with no build step.

## Data sources

| What                                                    | Source                      |
| ------------------------------------------------------- | --------------------------- |
| Binance: Spot, Funding, Earn, Futures, tokenized stocks | Binance API (read-only key) |
| EVM chains: tokens and DeFi positions                   | Zerion API                  |
| Solana: tokens, staking, tokenized stocks               | Zerion API                  |
| TON: TON and jettons                                    | TonAPI                      |
| Fallback prices                                         | CoinGecko                   |
| RSI, funding, open interest                             | Binance public API          |
| Fear & Greed                                            | alternative.me              |

## Quick start

Requires Node.js 24 or newer.

```sh
npm install
cp config.example.json config.json    # then fill in the API keys
npm run wallets -- add <address> [label]
npm run check
npm start                             # dashboard at http://127.0.0.1:8787
```

The dashboard collects on start and then on a schedule (`schedule.balancesMinutes` in `config.json`). Wallets
can be added, renamed and removed on the page itself.

Without a login the server listens on localhost only and refuses any other address.

### Console

`npm run wallets` lists, adds and removes wallets; the network (EVM, Solana or TON) is detected from the
address format. `npm run check` calls every source once and reports which keys and wallets work.

`npm run collect` reads every account, stores a snapshot in `data/stashboard.db` and prints the portfolio:
value per source, merged assets, categories and net worth. For Binance it also prints the exchange's own
valuation next to the collected sum. `npm run collect -- --show` prints the stored portfolio without calling
any API. If a source fails, its last good data is shown and marked, and the command exits with an error.

### Heat score

Every asset with a Binance market gets a heat score from 0 (cold) to 100 (overheated). It blends five
readings, each scored 50 at its neutral value and 80 at its overheated threshold:

| Reading                                 | Weight | Neutral | Overheated |
| --------------------------------------- | ------ | ------- | ---------- |
| Daily RSI(14)                           | 30%    | 50      | 70         |
| Weekly RSI(14)                          | 25%    | 50      | 75         |
| Funding rate, 3-day average, per 8 h    | 20%    | 0.01%   | 0.03%      |
| Price against its 200-day average       | 15%    | 0%      | +50%       |
| Open interest over 7 days, price rising | 10%    | 0%      | +30%       |

Under 30 is cold, 30–60 neutral, 60–80 warm, 80 and above overheated. A reading that does not exist for an
asset (no perpetual, a short price history) hands its weight to the others; tokenized stocks use RSI and the
average only. Weights, thresholds and zones are set under `heat` in `config.json`. Signals refresh every
`schedule.signalsMinutes`; `npm run collect -- --signals` recomputes and prints them.

This is a description of market conditions, not advice to buy or sell.

### Asset rules

[`assets.json`](assets.json) decides how holdings are merged and grouped: which wrappers count as the same
asset (WETH and stETH as ETH), which category an asset belongs to, and which tickers are stocks. Tokenized
stocks are matched by suffix, so `NVDAx`, `NVDAB` and `NVDAon` all count as NVDA. Edit the file to fit your
portfolio; anything it does not mention lands in "Other".

### Logos and icons

Token, chain and protocol logos are not part of the repository. Zerion and TonAPI name a logo for what they
return, and CoinGecko fills in the rest by ticker. The server downloads each image once, checks that it
really is an image, keeps it in `data/logos` and serves it from its own address. Your browser never asks a
third party for a logo, so nobody outside learns what the portfolio holds. An asset without a logo shows its
first letters instead.

Interface icons come from [Lucide](https://lucide.dev) (ISC licence), built into one sprite by the server.

### API keys

All free:

- **Binance:** create a _System generated_ (HMAC) key with only _Enable Reading_ ticked and restrict it to
  the IPs you will run Stashboard from. The check fails if the key can trade or withdraw.
- **Zerion:** [developers.zerion.io](https://developers.zerion.io)
- **TonAPI:** [tonconsole.com](https://tonconsole.com)
- **CoinGecko:** a Demo API key from [coingecko.com/en/api](https://www.coingecko.com/en/api)

`config.json` and the `data/` directory hold your keys and addresses and are ignored by git.

## Login

There is nothing to configure by hand. The first time the dashboard is opened on a server, it asks you to
create the account:

1. Enter the **setup code**. The server prints it in its log on every start until the account exists, and
   `deploy.sh` shows it at the end. It proves the server is yours, so whoever finds the address first cannot
   claim it.
2. Choose a password of at least 12 characters.
3. Scan the QR code with an authenticator app and enter one code to confirm it works.

From then on every page and API call needs a session; only the sign-in page is served without one. Sessions
last 30 days. Five wrong attempts from one address lock it out for 15 minutes, and each authenticator code
works once. The account (an argon2id hash of the password and the authenticator secret) lives in the
database, never in `config.json`.

Run on your own machine with `npm start`, the dashboard listens on localhost only and stays open until you
create an account at `/setup`. Set `REQUIRE_LOGIN=1` to demand one from the start.

Forgot the password or lost the phone? Remove the account and set it up again:

```sh
docker compose run --rm stashboard src/auth-reset.ts && docker compose restart stashboard   # on the server
npm run auth:reset                                                                          # locally
```

## Deploy

You need a server with Docker, ports 80 and 443 reachable from the internet, and a host name pointing at it
(a free [DuckDNS](https://www.duckdns.org) subdomain works). Set the host name in `config.json`:

```json
"domain": "example.duckdns.org"
```

Then:

```sh
./deploy.sh user@host            # SSH_PORT=2222 ./deploy.sh user@host for a non-standard port
```

It copies the project to `/opt/stashboard`, builds the image, checks the API keys from the server and starts
two containers: the app, and [Caddy](https://caddyserver.com) in front of it, which obtains and renews the
HTTPS certificate. The app publishes no port of its own. Run the script again to update.

On the server:

```sh
cd /opt/stashboard
docker compose logs -f stashboard                       # what the app is doing
docker compose run --rm stashboard src/wallets.ts       # the console commands work here too
```

### Backups

Once a day the app writes a copy of the database to `backups/` inside its data volume and keeps the last 14.
That protects against a bad update or a corrupted file, not against losing the server: copy a backup off the
machine now and then.

```sh
docker compose cp stashboard:/data/backups ./backups
```

### Continuous deployment

GitHub Actions checks formatting and types and runs the tests on every pull request and on every push to `main`
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). A push to `main` also deploys, once the repository
is configured under _Settings → Secrets and variables → Actions_:

| Kind     | Name                 | Value                                                                |
| -------- | -------------------- | -------------------------------------------------------------------- |
| Variable | `DEPLOY_HOST`        | Server address. Deploys stay off until this is set                   |
| Variable | `DEPLOY_USER`        | SSH user, default `root`                                             |
| Variable | `DEPLOY_PORT`        | SSH port, default `22`                                               |
| Variable | `DEPLOY_DIR`         | Remote directory, default `/opt/stashboard`                          |
| Secret   | `DEPLOY_SSH_KEY`     | Private key of a deploy-only SSH key pair                            |
| Secret   | `DEPLOY_KNOWN_HOSTS` | Optional: output of `ssh-keyscan <host>`, pins the server's host key |

The pipeline never sees `config.json`: run `./deploy.sh` once from your own machine to upload it, and CI
deploys keep the copy that is already on the server. To change keys or the domain, deploy from your machine
again.

## Development

```sh
npm run format        # format everything with Prettier
npm test              # unit tests
npm run lint          # formatting check + typecheck + tests, the same as CI
```

## Brand

The mark is three stacked bars: a stash, a bar chart, and the heat scale the product is built around.
Teal is cold, bone is neutral, amber is hot.

| Token | Hex       | Use                         |
| ----- | --------- | --------------------------- |
| Ink   | `#0B0F14` | Page background             |
| Bone  | `#EDE8DC` | Primary text, neutral       |
| Slate | `#8A93A0` | Secondary text              |
| Amber | `#F2B33D` | Accent, warm and overheated |
| Teal  | `#4CC9C0` | Cold                        |

Logo files: [`assets/logo.svg`](assets/logo.svg), [`assets/logo-wordmark.svg`](assets/logo-wordmark.svg).
