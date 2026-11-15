<p><img src="assets/logo-wordmark.svg" alt="Stashboard" height="56"></p>

**Your whole stash on one board.** A self-hosted, read-only portfolio dashboard for people whose money is
spread across an exchange, several chains and a handful of DeFi protocols.

Stashboard pulls balances from Binance, EVM chains, Solana and TON into one net-worth view, shows how the
portfolio is allocated, keeps its history, and scores every position from cold to overheated so you can see
what to trim and what to leave alone.

> **Status:** early development. Collection works from the console; the dashboard is next.
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
npm run collect
```

`npm run wallets` lists, adds and removes wallets; the network (EVM, Solana or TON) is detected from the
address format. `npm run check` calls every source once and reports which keys and wallets work.

`npm run collect` reads every account, stores a snapshot in `data/stashboard.db` and prints the portfolio:
value per source, merged assets, categories and net worth. For Binance it also prints the exchange's own
valuation next to the collected sum. `npm run collect -- --show` prints the stored portfolio without calling
any API. If a source fails, its last good data is shown and marked, and the command exits with an error.

### Asset rules

[`assets.json`](assets.json) decides how holdings are merged and grouped: which wrappers count as the same
asset (WETH and stETH as ETH), which category an asset belongs to, and which tickers are stocks. Tokenized
stocks are matched by suffix, so `NVDAx`, `NVDAB` and `NVDAon` all count as NVDA. Edit the file to fit your
portfolio; anything it does not mention lands in "Other".

### API keys

All free:

- **Binance:** create a _System generated_ (HMAC) key with only _Enable Reading_ ticked and restrict it to
  the IPs you will run Stashboard from. The check fails if the key can trade or withdraw.
- **Zerion:** [developers.zerion.io](https://developers.zerion.io)
- **TonAPI:** [tonconsole.com](https://tonconsole.com)
- **CoinGecko:** a Demo API key from [coingecko.com/en/api](https://www.coingecko.com/en/api)

`config.json` and the `data/` directory hold your keys and addresses and are ignored by git.

## Deploy

```sh
./deploy.sh user@host            # copies the project to /opt/stashboard and builds it with Docker Compose
```

For now the deploy only runs the key check from the server's IP; the long-running service comes with stage 4.

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

The pipeline never sees `config.json`: upload it once with a local `./deploy.sh`, and CI deploys keep the copy
that is already on the server.

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
