# Changelog

## Unreleased

- Stashboard can sit on a phone's home screen. **Add to Home Screen** gives it the Stashboard icon instead of a
  picture of the page, and it opens without the browser bar. Coming back to the dashboard after a minute or more,
  in an app or a tab, loads the latest balances.
- An exchange takes a new API key without losing its history. When a Bybit or Gate key expires, or you make a
  new one, the key button of the exchange in Accounts opens the same dialog as adding one. The new key is checked
  to only read, and the exchange is read again straight away. Before, the only way was to remove the exchange,
  which deleted its history, and add it again.
- A wallet or exchange you add no longer shows as growth. The 24-hour, 7-day and 30-day changes compare only
  the accounts that were already there, so adding a $20,000 exchange to a $2,000 wallet yesterday no longer
  reads as +1,000% today. While those accounts hold less than half of the portfolio, the change is the
  estimate from prices, marked ≈, until history reaches far enough back.

- A board for friends on one server. The new Board tab is a short table of everyone's portfolio by net worth:
  the place, a made-up name of a Grand Theft Auto character (the real one for the admin), the five largest
  holdings with their logos, how many wallets and exchanges, and the amount. The name opens that portfolio in the usual dashboard, to look through but not
  change, with accounts named after their kind and no addresses. Everyone is on it until they turn off **Show me on the board** in Settings, and then they no longer
  see it either. It opens at three portfolios.

- A holding that turns cold gets a notice too, like an overheated one: which assets, how much of the portfolio,
  _Show in Signals_ for the cold zone and _Dismiss_. Only assets already held are considered. A rise into
  neutral and back keeps it dismissed, and warming up before turning cold again brings it back.
- An update reads one person's accounts at a time, largest first, the order of their chips, instead of jumping
  between everyone's accounts by balance. Pressing **Update now** while an update runs no longer joins it
  silently: the button stays disabled and the line under the net worth says when your accounts start.
- TON wallets no longer fail with "tonapi.io → HTTP 429" when there are many of them. Requests to TonAPI are
  spaced under its free tier's one a second, the GRAM price is asked once per update instead of once per
  wallet, and a refused request is tried again after a pause shown on the wallet's chip.
- The line under _Add your first account_ is as wide as the cards below it, so on a computer it fits on one line.
- The admin can reset a friend's sign-in. The key next to their name under People copies a reset link that
  works once, for 7 days. On it the friend chooses a new password and adds the authenticator again, and keeps
  their name, accounts and history. Before, the only way was to remove them and invite them again.
- BingX next to Binance, Bybit, OKX and Gate: add a read-only API key on the page. BingX reads Spot, Funding,
  USDT and coin-margined perpetuals and standard futures. Earn, copy trading and grid bots have no API, so a
  warning names them with their value. Adding a key no longer fails with "open-api.bingx.com → NaN": BingX
  sends the key's permissions without the usual wrapper.
- Icons no longer blink on an iPhone during an update. The icon sprite is part of every page now. As a file of
  its own, Safari and every other iPhone browser asked the server for it again whenever the account chips were
  redrawn, every second during an update. Chips are also redrawn only when their own state changes, so the
  spinner of the account being read keeps turning.
- Interface text is shorter. Explanations of how Stashboard works inside are gone (Accounts, Positions, DeFi,
  history, the first read), the Signals sentence that repeated the heat scale is gone, the empty dashboard
  just offers a wallet or an exchange, dialogs for removing an account or a person and the invite line say only
  what happens, the heat notice is one line, and the Accounts view no longer repeats the add button of the
  chips. Settings shows the Zerion requests left only to the admin, without the update arithmetic.
- On a phone Positions leaves out the share column, so a row fits without scrolling sideways.

- On a phone the tab bar stays where it is. It could scroll by a pixel, so a swipe on it dragged the tabs up,
  down and sideways, and an invisible copy of the net worth took the room of the last tab, cutting Accounts to
  "Acco". The five tabs now share the width, and the overheated and trouble counts are a dot there.
- A new person sees changes at once. The 24-hour change is estimated from prices too, signals and price
  changes are computed for a new account's assets right after it is read instead of up to four hours later, and
  a change that cannot be shown yet is a dash instead of "in 7 days" under "7 days".
- The DeFi tab shows only when there are DeFi positions.
- The Dismiss link of a notice no longer breaks into letters on a narrow screen.
- TON and GRAM are one asset. The coin was renamed GRAM in 2026, exchanges list it as GRAM, and TON wallets were
  still read as TON, so the same coin showed twice. TON wallets are read as GRAM now, and TON counts as GRAM in
  history too. Its heat comes from the GRAM market, since the TON one stopped.
- Exchange keys need not be bound to an IP address. The dialog asks for none on Binance and OKX. On Bybit and Gate,
  which turn off an unbound key after three months and 90 days, it shows this server's address with a Copy
  button, and adding an unbound key there warns that it will stop. Other keys no longer warn about IP addresses,
  and neither does `npm run check`.
- `npm run wallets` is gone. Wallets are added, renamed and removed on the dashboard, which also reads a new one
  straight away.
- A `binance` block in `config.json` is no longer imported. Installs from before exchanges were added on the
  page imported it on their first start, so the block can be deleted.
- When Zerion has never answered for a wallet's DeFi positions and refuses, they are left out with a warning.
  They used to be taken from the last stored update, which could count Aster a second time.
- `npm run check` reads TON wallets the way an update does.
- Code nothing used is gone, and a test fails when a module exports a name nothing imports.

- A notice under the accounts says when a holding turns overheated: which assets, with their heat and share of
  the portfolio, and a link to Signals showing only them. Dismissing it holds on every device until the asset
  cools to neutral or cold and overheats again.
- Zerion is asked up to three times a second, as its free plan allows, instead of once, so an update with many
  wallets finishes sooner. A key that refuses that pace is asked once a second for an hour.
- A wallet or exchange that has just been added is read on its own, not with every account on the server.
- Updates are spaced so a day of them fits in Zerion's allowance, from the key's limit and the number of EVM
  and Solana wallets. The schedule never runs faster, an update asked for pushes the next scheduled one back,
  and **Update now** stays greyed out, saying when it comes back, until the gap has passed. Settings shows how
  many updates a day the key allows.
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
