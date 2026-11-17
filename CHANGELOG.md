# Changelog

## Unreleased

- The DeFi tab counts the cards it shows. It counted protocol names instead, including ones worth under a
  dollar that the view leaves out, and a protocol on two chains once.
- A pending invite link can be copied again from its row in Settings. The token is kept encrypted with the same
  key as exchange secrets. Invites made before this keep only a hash, and their link cannot be shown again.
- Gate next to Binance, Bybit and OKX: add a read-only APIv4 key on the page. Gate reads the unified account,
  or Spot and perpetual futures on a classic account, and Simple Earn, fixed-term Earn and staking.
- Aster is read for every EVM wallet without a key, like Lighter: futures collateral with unrealised PnL,
  spot balances and staked ASTER, priced from Aster's own tickers. It needs the account's privacy mode off.
  A wallet that never opened an Aster account is not a failure.
- Until history reaches 7 or 30 days back, those changes are estimated from prices: today's holdings at the
  prices of that many days ago, marked with `≈` and a note on what they cover.
- Positions no longer has RSI and Funding columns. Both stay in Signals.
- The external-link icon after a link in the add dialog sits on the line with a little space, instead of
  touching the text and floating above it.
- Views no longer jump back on their own in Arc. Switching wrote the view into the address, and Arc then
  showed a picture of the page from before the click until the pointer moved. The open view is now kept by the
  tab without touching the address or the history.
- Adding an account shows logos: the networks a wallet covers and each exchange, the network of a pasted
  address inside the field, and what will be read under it. Exchanges are drawn with their own logo everywhere,
  Bybit included.
- Settings: shared links, people and invites show their count and fold after the first few rows, the name to
  sign in with is changed with a pencil, Hide amounts is described in one line, and scrolling over an open
  panel or dialog no longer moves the page behind it.
- Lighter is no longer counted twice: Zerion now lists the Ethereum deposit into Lighter too, and that copy is
  dropped, in history as well.
- An update reads accounts from the largest balance down, in the order the page lists them.
- The update button sits before the line under the net worth, so it no longer jumps, or vanishes on a phone,
  each time that line changes during an update.
- Forms are checked by the page with its own messages instead of the browser's bubbles.
- Bybit and OKX next to Binance: add a read-only API key on the page. Bybit reads Unified Trading, Funding and
  Earn, OKX reads Trading, Funding and Earn and needs the key's passphrase. A key from a regional site (Bybit
  Turkey, Kazakhstan, Georgia, UAE or Indonesia, OKX EEA or US) is recognised by itself.
- `npm run check` checks every stored exchange key and reads its balances.
- Several people on one server. The admin invites friends with a one-time link from Settings; each signs in
  with a name, a password and an authenticator and sees only their own accounts, history, categories chosen
  by hand, hidden-amounts setting and shared links. One collection run and one Zerion key serve everyone.
  An existing install becomes the admin's, named `admin`, and anyone can change their name in Settings.
- _Start history over_ is gone. History is kept as it was read.
- Removing an account and turning off a shared link work again: the page no longer sends a JSON content type
  with an empty body, which the server refused.
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
