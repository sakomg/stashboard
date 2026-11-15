# Stashboard — plan

A self-hosted portfolio dashboard: Binance, EVM, Solana, TON and DeFi positions in one place, with
allocation, history and per-token overheating indicators.

Name: **Stashboard** (stash + dashboard). Everything in the project is in English: code, docs and interface.

## 1. Principles

- **Read-only.** Binance uses a read-only key restricted to trusted IPs; wallets are public addresses only. No seed phrases, no signatures.
- **Your data stays with you.** SQLite on your own server; nothing goes to third-party trackers.
- **Free.** Every data source must work on a free tier. No paid APIs.
- **Open to the internet, closed by login.** HTTPS, password + TOTP (section 6).
- **Few dependencies.** One app container + Caddy, one database file, a frontend with no build step.
- **A source may fail, the dashboard may not.** Collectors are isolated; on error the last data is shown, marked stale.

## 2. Architecture

```
              ┌──────────────────── stashboard container ─────────────────────┐
 Binance ────▶│ collectors/binance ─┐                                          │
 Zerion ─────▶│ collectors/evm      ─┤                                         │
 Zerion ─────▶│ collectors/solana   ─┼▶ normalize ▶ SQLite ▶ HTTP API ▶ UI     │─▶ Caddy (HTTPS) ─▶ internet
 TonAPI ─────▶│ collectors/ton      ─┘     ▲          ▲                        │   login: password + TOTP
 CoinGecko ──▶│ pricing (fallback prices) ─┘          │                        │
 Binance pub ▶│ signals (RSI, funding, OI) ───────────┤                        │
 alternative ▶│ signals (Fear & Greed) ───────────────┘                        │
              │ scheduler: balances hourly, signals every 4 hours              │
              └────────────────────────────────────────────────────────────────┘
```

**Stack:** Node.js 24 + TypeScript (run directly, no build), Fastify, built-in `node:sqlite`, a static
frontend (vanilla JS + ECharts), Docker Compose, Caddy.
**Deploy:** `deploy.sh` to `/opt/stashboard`, data in a docker volume.

### Data sources

| What                                                    | Source                  | Notes                                                                    |
| ------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| Binance: Spot, Funding, Earn, Futures, tokenized stocks | Binance API (read-only) | Earn tokens (LD*) are folded into the base asset                         |
| EVM: tokens + DeFi positions, all chains                | Zerion API (free tier)  | One request per second per key; DeFi positions included                  |
| Solana: tokens, staking, tokenized stocks               | Zerion API (free tier)  | Plain tokens and staking only; fallbacks: Solana RPC + Jupiter Price API |
| TON: TON + jettons                                      | TonAPI                  | Prices come with balances; whitelist filter                              |
| Fallback prices                                         | CoinGecko               | 5-minute cache                                                           |
| Candles, funding, open interest                         | Binance public API      | No key                                                                   |
| Fear & Greed                                            | alternative.me          | Once a day                                                               |

Rule for a new protocol: Zerion must see it. If it does not, write a separate collector with the same
interface (`collect(account) → holdings[]`) on top of the protocol's own free API.

### Data model (SQLite)

- `accounts` — a source: kind, label, address. Wallets are added and removed through the interface, not `config.json`.
- `snapshots` — a collection run: time, status per source.
- `holdings` — a row per (snapshot, account, asset): chain, protocol, symbol, quantity, price, USD value, type (wallet / earn / staked / lp / lending / borrow / perp / locked / reward).
- `assets` — a canonical asset: key, symbol, category (BTC / ETH / stables / L1 / DeFi / memes / stocks), Binance pair for signals.
- `signals` — per asset and time: daily and weekly RSI, funding, OI change, distance from the 200-day average, heat score.
- `targets` (optional) — target share of an asset or category.

Debts (an Aave loan) are stored with a negative value: the portfolio total is net worth.

### Asset merging

One asset in several places counts as one: USDT on Binance + on Arbitrum + on TON = USDT.
`assets.json` defines which contracts and symbols belong to a canonical asset and what to group
(WETH, stETH, aWETH inside ETH, expandable). An LP position is split into its tokens.
Unknown tokens with a price are shown as is; without a price or under $1 they are hidden as dust/spam.

### Heat score

For every asset with a Binance pair, 0–100:

| Component                         | Weight | Overheated      |
| --------------------------------- | ------ | --------------- |
| RSI(14) daily                     | 30%    | > 70            |
| RSI(14) weekly                    | 25%    | > 75            |
| Funding rate (3-day average)      | 20%    | > 0.03% per 8 h |
| Price vs the 200-day average      | 15%    | > +50%          |
| 7-day OI growth while price rises | 10%    | > +30%          |

Zones: 0–30 cold, 30–60 neutral, 60–80 warm, 80+ overheated. Weights and thresholds live in the config.
An asset without a futures market is scored on the available components with weights rescaled.
Tokenized stocks use RSI and the average only.

## 3. Dashboard design

One page, dark theme, responsive down to a phone. Visual language follows the logo: ink background,
bone text, a teal → bone → amber heat scale. Top to bottom:

1. **Header.** Net worth, change over 24 h / 7 d / 30 d, Fear & Greed, last update, status of each source.
2. **Allocation.** Donut chart with a switch: by asset / category / chain / venue / type (wallet, DeFi, exchange). Next to it: top-5 positions and the stablecoin share.
3. **History.** Value over time stacked by category; 7 d / 30 d / 90 d / all.
4. **Positions table.** Asset, quantity, price, value, share, 24 h and 7 d change, RSI, funding, heat badge. Sortable; a row expands into "where it is held".
5. **DeFi.** By protocol: deposits, loans, LP, perps, locks, rewards; health factor for Aave.
6. **Signals.** Overheated and cold positions by descending share, with the components that fired.
7. **Wallets.** Add, label and remove wallets; the network is detected from the address.

## 4. Stages

| #   | Stage                 | Result                                                          | Verification                                                                 |
| --- | --------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 0   | Preparation           | Keys in `config.json`, wallets in the database, `npm run check` | Every key answers; totals match the wallets                                  |
| 1   | Collectors + database | `npm run collect` prints a portfolio summary                    | Each source's total matches Binance / the wallet / the protocol UI within 1% |
| 2   | API + dashboard       | Blocks 1–5 and 7 work locally                                   | Numbers match the console                                                    |
| 3   | Signals               | Heat score, block 6, RSI / funding columns                      | RSI checked against TradingView on 3 tokens                                  |
| 4   | Login and deploy      | Password + TOTP, Caddy, domain, schedule, daily database backup | API returns 401 without a session; a day without gaps in `snapshots`         |
| 5   | Optional              | Targets and drift, sentiment                                    | —                                                                            |

## 5. Risks

- **Free-tier limits** (Zerion, TonAPI, CoinGecko): Zerion allows one request per second; daily quotas are unconfirmed. Collect less often if needed.
- **Zerion coverage:** protocols it does not index (for example Lighter) need their own collector.
- **Solana DeFi:** Zerion returns only plain tokens and staking for Solana addresses.
- **Binance from the server's IP:** check that the API is not blocked for the server's region.
- **DeFi on TON:** LP and staking jettons arrive as plain tokens; valuation may be off.
- **Ports 80/443 on the server:** Caddy needs them for the certificate; check they are free.
- **Assets without a Binance pair:** price and share only, no signals.

## 6. Security

- **Caddy** in front of the container: automatic HTTPS; the app listens only on the internal docker network.
- **Login:** one user, password (argon2) + TOTP; session in an httpOnly / Secure / SameSite=Strict cookie for 30 days.
- **Brute force:** at most 5 attempts per 15 minutes per IP, then a lockout.
- **Without a session everything is closed** except the login page, including the API.
- **Secrets:** `config.json` with mode 600, never in git; the Binance key is never returned by the API; addresses are shortened in the interface.
- **Headers:** strict CSP (own scripts only), HSTS, `X-Robots-Tag: noindex`.
- **Worst case on a breach:** portfolio composition, addresses and a read-only key. No withdrawals, no trading.

## 7. Decisions

- "Stocks" are tokenized wrappers on Binance, Solana and EVM chains.
- DeFi positions are in scope.
- No paid data sources. EVM and Solana both go through Zerion's free tier.
- Wallets are managed in the interface, not in the config.
- English everywhere: code, docs, interface.
- Reachable from the internet behind a login.
- The project may be shared or open-sourced: no personal data, keys or addresses in the repository.
- No Telegram integration.
