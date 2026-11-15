# Changelog

## Unreleased

- The source is organised in layers (`lib`, `domain`, `storage`, `sources`, `services`, `auth`, `server`, `cli`)
  with the dependency direction enforced by a test. The server is split into a context, access control, static
  files, the collection schedule and routes by area; the database module into one module per concern.
- The page is split into one module per part of the dashboard and stylesheets for base, components and each
  page, served from folders that set who may load them.
- Tests for access control over HTTP, the page modules and the layering.
- `.nvmrc`, `.gitattributes` and Dependabot for npm, GitHub Actions and Docker.

## 1.0.0

The first public release.

- Balances from Binance (Spot, Funding, Earn, Futures, tokenized stocks), EVM chains and Solana through
  Zerion, TON through TonAPI, and Lighter, merged into one portfolio.
- Allocation by category, asset, chain, account and kind, with every place an asset is held.
- History of the portfolio and changes over 24 hours, 7 and 30 days.
- Heat score per asset from RSI, funding, the 200-day average and open interest, explained and sourced.
- Categories from `assets.json`, CoinGecko tags, or chosen by hand.
- Hide amounts on every device, a share picture, and time-limited share links.
- Wallets and read-only exchange keys added on the page, keys checked and stored encrypted.
- Sign-in with a password and an authenticator app, created on first visit with a setup code.
- Logos downloaded and served by the server.
- Zerion free-tier budgeting with a per-wallet cache.
- Loading, empty and first-read states, and live progress during updates.
- `install.sh` for one-command installs, `deploy.sh` for deploying from a computer, daily backups.
- A demo with made-up data: `npm run demo`.
