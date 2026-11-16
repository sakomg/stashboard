# How Stashboard works

This is the reference for anyone changing the code. The code itself carries no comments: the reasons behind
it live here, next to the user-facing [README](../README.md).

## Project layout

```text
src/
  main.ts          entry point: builds the server, starts the schedule and backups, listens
  lib/             config loading and JSON over HTTP with safe error text
  domain/          pure logic, no I/O: addresses, asset rules, portfolio maths, heat score, indicators, types
  storage/         SQLite: schema and migrations, one module per concern, and the vault for secrets
  sources/         one client per external API: Binance, Zerion, Lighter, TonAPI, market data, Fear & Greed
  services/        processes that combine them: collection, signals, categories, logos, exchanges, shares, views
  auth/            password hashing, TOTP, attempt limiting, the setup QR code
  server/          HTTP: context, access control, static files, the collection schedule, routes by area
  cli/             console commands: check, collect, wallets, auth-reset, demo
public/
  common/          served to every page: core components (ui.js) and base, component and sign-in styles
  dashboard/       the dashboard: index.html, main.js and one module per part of the page, its styles
  login/ setup/    the sign-in and first-run pages
  share/           the public page a shared link opens
test/              mirrors src/, plus tests of the server over HTTP, the page modules and the layering
docs/              this file, the self-hosting guide and the user guide
assets/            the logo and the README screenshots
```

Dependencies point down: `lib` ← `domain` ← `storage`, `sources` ← `services` ← `server`, `cli` ← `main`. `domain`
does no I/O and imports only `lib`, so it is tested without a database or a network. `test/architecture.test.ts`
fails when a module imports a layer it should not, and when a new folder in `src` has no place in the layering.

The server is assembled by `createApp` from a `Context` (config, database, resolvers, whether sign-in is set up)
that `createContext` builds from the environment or that a test passes in. Routes live in `server/routes` by area
(sign-in, dashboard, accounts, shares, people); `server/collection.ts` owns the schedule, the progress of a run
and the update gate.
`test/server/access.test.ts` drives the whole app through `app.inject` to check who may open what.

On the page, `dashboard/main.js` loads data and renders; every other module owns one part of the page and
exports its render function. Modules that need to reload or re-render call `actions.load` or
`actions.renderAll` from `state.js`, which `main.js` fills in, so no module imports `main.js` and the import
graph has no cycles. `main.js` imports the modules that only register event handlers (dialogs, settings,
sharing, views) by name, since nothing else would load them. `test/web/modules.test.ts` checks that every module
is reached from `main.js`, that every imported name is exported, and that there are no cycles.

## Collection

A run reads the accounts of every person one after another, into one snapshot. An account that fails is
recorded as an error and the others go on; the failed one keeps showing its last good balances, marked out of
date.

Nothing is stored until every account has been read. Then holdings that come from an earlier answer of a
source (see Zerion below) take this run's price for the same symbol, or for the token a `W`-wrapper wraps
(WETH takes ETH's price), keeping their quantity. Only then is the snapshot written, so the page never sees a
half-finished run. An account removed while the run read it, alone or with the person who held it, is left
out.

An EVM address is read twice: by Zerion for chains and protocols, and by Lighter for what sits on its
exchange, which wallet indexers cannot see.

While a run is going, the collector reports each account as waiting, being read, waiting on a source, done
or failed. The server keeps that state and serves it at `/api/progress`, to each person only for their own
accounts; after the accounts it reports the signals phase.

After the balances, signals are recomputed if they are older than `schedule.signalsMinutes`. Logos and
categories of newly seen assets are fetched in the background: they are cosmetic and never hold up an update.

The schedule runs every `schedule.balancesMinutes` (at least 5). On start, a run happens only if the last
snapshot is older than that, so a restart or a deploy does not trigger a collection by itself.

### Manual updates

An update asked for on the page reads everyone's accounts, since they share one run and one Zerion key. It is
refused while one runs, for a minute after the last one finished, and, when there are EVM or Solana wallets,
while Zerion's daily allowance is used up. The server answers 429 with
the reason and when updates are possible again; `/api/portfolio` and `/api/progress` carry the same answer, so
the page disables its update button, says why on hover (and under the net worth when the wait is long), and
enables it again by itself when the time comes. The scheduled updates are not affected. Adding a wallet
starts a collection on the server, so a new wallet is read straight away even inside the minute.

### History

Categories that never reach 0.1% of the portfolio's peak are left out of the chart, so leftovers of a few
cents do not show up as a band or a legend entry.

The history chart sums the value of every one of the person's accounts per category at every snapshot that
read one of them, so it starts when they added their first account. An account that failed in a
snapshot keeps its previous value there, so a source being down does not show as a drop in net worth. Long
ranges are thinned evenly to 240 points, always keeping the most recent one. The 24-hour, 7-day and 30-day
changes compare with the snapshot at or before that time and stay empty until history reaches that far.

## Sources

### Binance

An exchange is added on the page (Add wallet or exchange, Exchange) with an API key and its secret. Before anything is
saved, the key's permissions are read from Binance (`/sapi/v1/account/apiRestrictions`): a key that can trade,
transfer or withdraw is refused with the permissions named, a key not restricted to trusted IP addresses is
accepted with a warning. Several Binance accounts can be added; the same key twice cannot. Removing an exchange
removes its history and its stored key. The page only ever sees the last four characters of a key.

`binance` in `config.json` still works as a seed: on start, a key found there is imported once, onto the
existing Binance account if there is one, so its history stays. The import is remembered by a fingerprint of
the key, so an exchange removed on the page does not come back from the file; a different key in the file is
imported as a new account.

The key must be read-only; the deploy check fails if it can trade or withdraw. Every wallet is read separately, and
a wallet the account never opened answers with an error that must not hide the wallets that work. Public
endpoints in the check also reveal whether Binance blocks the server's region.

Prices come from the spot tickers, through USDT or the nearest liquid quote. Fiat and some stablecoins are
quoted the other way round (USDTTRY) and are inverted.

A flexible Earn position also appears in Spot as a receipt token, `LD` plus the asset (`LDUSDT`). The prefix
alone proves nothing, since LDO is a real token, so a balance counts as a receipt only when Earn lists that
asset, or, if Earn could not be read, when the token has no market of its own.

Futures are counted at margin balance: wallet balance plus unrealised PnL, per collateral asset. Binance's own
valuation of every wallet is kept as a cross-check, and `npm run collect` prints it next to the collected sum.

### Zerion

Zerion's key reports its allowance in response headers (`ratelimit-org-*`): about one request a second, a
daily allowance, and a quarter of it for reads of positions in protocols (`only_complex` or `no_filter`).
When that quarter is used up, those reads return 429 while plain reads keep working. Zerion may also refuse
repeated requests for the same wallet in a short time.

To stay inside it:

- Plain tokens (`only_simple`) and positions in protocols (`only_complex`) are separate requests, each kept
  per wallet in the `zerion_cache` table. Plain tokens are reused for 10 minutes, so adding a wallet, a second
  click or a restart does not re-read every other wallet. Positions in protocols are reused for 55 minutes
  on a key allowing 1,000 or more requests a day, so every hourly run reads them, and for 3 hours on a
  smaller key.
- Requests are at least 1.1 seconds apart. A 429 is retried after 2, 5 and 10 seconds. A read of positions
  in protocols refused twice in a row is the quarter being used up, not a burst, so no more such reads are
  sent until the daily allowance renews (at least an hour).
- Nothing is sent while the day is down to its last 5 requests, so a manual update late in the day still has
  room once it renews.
- When Zerion refuses, the last answer is used and the account carries a warning saying how old it is. If
  nothing was kept yet, positions in protocols fall back to those stored by the last good collection, without
  Lighter, which is read separately. An old position is better than a missing one.
- `npm run check`, which every deploy runs, checks every stored exchange key (or the one in `config.json` before it is
  imported) and spends one request on the chain list instead of reading wallets,
  and prints the allowance left. The chain list for logos and names is fetched once a week.

Zerion reports only plain tokens and staking for Solana, so Solana wallets make one request.

Tokens Zerion cannot price are almost always airdropped spam: they are counted in the warnings, not listed.

A lending deposit shows up twice: as the position in the protocol and as the receipt token the protocol
handed out (`aEthWETH` for WETH lent on Aave). The receipt is dropped when the deposit it stands for is
listed on the same chain; a receipt without a listed deposit is kept, so the money is counted either way.

### Lighter

Lighter is a perpetuals exchange on its own rollup. Its public API finds the account of an EVM address
without a key. There are two separate exchanges: the main one, funded from Ethereum with USDC, and one on
Robinhood Chain with USDG. An address that never used one answers with code 21100, which means no account,
not a failure.

Each account becomes one holding worth its equity (collateral plus unrealised PnL), in the stablecoin that
backs it and of type futures, the same way Binance futures wallets are counted. Open positions are not
shown separately and are not exposure in the portfolio: only the equity counts.

### TonAPI

Anyone can send any jetton to any wallet, so only whitelisted jettons count; the rest is mostly spam. TonAPI
answers without a key at a much lower rate, which is not enough for scheduled collection.

TonAPI has no image for the native coin, and a lookup by ticker finds an unrelated token that shares it
(Tokamak Network), so the TON logo is named explicitly.

### Market data and Fear & Greed

Candles include the one still in progress. Funding is averaged over the last three days and expressed per 8
hours; summing first makes it independent of the contract's funding interval (8, 4 or 1 hours). Open
interest change is measured in contracts over seven days; some contracts have no history, which is a missing
reading rather than a failure.

The Fear & Greed index changes once a day. It is kept for six hours and then served stale while a fresh copy is
fetched in the background, so the dashboard never waits on alternative.me. With nothing kept yet (just after a
start, which also warms it), the dashboard waits at most 1.5 seconds and shows the index on its next refresh.

## Assets and categories

The resolver turns a symbol as a source spells it into a canonical asset:

1. Tokenized stocks are recognised by suffix: `NVDAx`, `NVDAB` and `NVDAon` are NVDA.
2. An Aave deposit receipt is the token that was lent: the market prefix (`aEth`, `aArb`, `aBas`, …) is
   removed, so `aEthWETH` becomes WETH and then ETH.
3. Aliases from `assets.json` are matched by exact spelling first, then in upper case, because wrappers
   differ by case (stETH, cbBTC) and plain tickers do not.

The category is the one chosen by hand on the page, then the one in `assets.json`, then one looked up, and
otherwise "Other". A choice by hand belongs to the person who made it (`user_categories`), so each request
builds a resolver with that person's choices; looked-up categories are shared. Collection, signals, logos and
lookups use the shared resolver, without anyone's choices.

Lookups run after a collection for assets in "Other" worth at least a dollar, at most 25 per run, 2.5 seconds
apart to stay within CoinGecko's free rate. Several coins can share a ticker; the one with the largest market
cap is taken, which is right for anything worth holding and can be corrected by hand. The coin's tags are
mapped in order, first match winning, so the more specific reading comes first: Memes, Stablecoins, Stocks,
L2, L1, DeFi (exchanges, lending, derivatives, staking, launchpads, bridges, oracles, marketplaces, RWA), and
L1 for a smart-contract platform not tagged as a layer outright. A miss is retried after a day; a 429 stops
the run and leaves the rest for the next one.

In the merged portfolio, the quantity of an asset held through different wrappers is a sum and therefore an
approximation (ETH plus wstETH). Its price is that of the canonical symbol when held directly, otherwise
value divided by quantity.

## Signals and heat

The thresholds and weights are in the README. In addition:

- RSI is Wilder's, the value TradingView shows.
- Tokenized stocks trade on Binance spot with a `B` suffix (NVDAB) and are scored on price action alone,
  since their perpetuals follow a different market. An asset without a spot market takes candles from its
  perpetual.
- Rising open interest counts as leverage piling in only while the price rises too; otherwise it reads as
  neutral.
- Stablecoins and assets under a dollar are not scored. One asset failing does not stop the rest.

## Logos

Sources name a logo URL for what they return; the server downloads each image once, stores it in
`DATA_DIR/logos` and serves it from its own address. The browser never asks a third party, so nobody outside
learns what the portfolio holds, and the repository ships no brand assets.

For each wanted logo the candidates are: the address its source named, then CoinGecko by symbol (a tokenized
stock by its wrapper ticker, `NVDAx`), then the logo of a wrapper (WETH's for ETH). Hosts often label images
as generic binary data, so an image is recognised by its first bytes (PNG, JPEG, GIF, WebP, SVG) and must be
under 512 KB. A download has 8 seconds and one retry; a failure is retried six hours later. Six run at a time.

When a source names a different address for a logo, the stored image is dropped and fetched again. The
address on record stays the one the source named even when a fallback supplied the image, so the same hint
arriving again is not taken for a new one. The page asks for each logo under a version that changes with the
image, because browsers keep logos for a week. Logos are served with a sandbox policy, so even an SVG opened
directly cannot run anything.

Accounts are drawn with the logo of their native coin: Binance with BNB, EVM with ETH, Solana with SOL, TON
with TON. Interface icons come from Lucide; the server builds one sprite, `/icons.svg`, with only the icons
the pages use.

## Sharing

The share card is drawn on a canvas in the browser, 1200 × 675 at twice that resolution, from the same
groups the allocation strip shows, grouped by any dimension. The logo, the font and every token logo come
from this origin, so the canvas stays exportable. It can be copied as an image (the clipboard gets the image
as a pending promise, which Safari requires), downloaded, or handed to the system share sheet where the
browser can share files.

With amounts, the card and the link lead with the net worth, the figure the dashboard shows, and the groups
add up to it (see Allocation under The page). When something is borrowed, a line under the net worth gives
what is held and what is borrowed. A link made before the net worth was sent shows the total held instead.

A link is a snapshot, frozen when it is made. The page sends the groups; the server checks and caps them
(a title of 80 characters, at most 12 rows, shares as finite numbers, colours as `#rrggbb`, logos only of a
known kind) and keeps amounts only when they were asked for, whatever else the request carries. The token is
16 random bytes in base64url. A link belongs to the person who made it: only they see it in their settings
panel and can turn it off. It lasts 1, 7 or 30 days, and expired links are deleted the next time a list is
read.

Without a session, only this is served: the page at `/s/<token>`, its data at `/api/shared/<token>`, logos
at `/s/<token>/logo/<kind>/<key>` for logos that link's rows name, and the files that page needs (`share.js`,
`app.css`, the logo, the font and the icon sprite). A dead link answers 404 with a plain message.

## Security

- **People.** Each person has a name, a password and an authenticator, and sees only their own accounts,
  history, categories chosen by hand, hidden-amounts setting and shared links. The session decides whose data
  a request reads: every query of accounts, snapshots, shares and categories takes the person's id, and an
  account id or link token of someone else answers 404 as if it did not exist. Collection, signals, logos and
  looked-up categories are shared, since they are about markets rather than anyone's holdings; the logo list
  a page gets names only what that person holds. Names are compared without case or surrounding spaces.
- **The admin** is person 1. They exist from the first start, without a password, and the setup page gives
  them a name, password and authenticator. Only the admin invites and removes people, and cannot be removed.
  Removing a person deletes their accounts with their history and keys, sessions, categories and links, after
  copying the database to `backups/stashboard-before-removing-a-person-<time>.db`.
- **Access.** Once the admin has signed up, every page and API call needs a session; only the sign-in and
  join pages and their assets are open. Before that, a server reachable from other machines serves only the
  setup page, and signing up needs the setup code printed in the server log, so a stranger who finds the
  address first cannot claim it. On localhost alone the dashboard is open as the admin's, unless
  `REQUIRE_LOGIN=1`, and nobody can be invited until the admin has signed up.
- **Setup.** The setup code is 12 characters from a 32-character alphabet without look-alikes, about 60
  bits, printed with a `[setup-code]` marker that `deploy.sh` looks for. The password and authenticator
  secret chosen in the first step stay in memory until a code proves the authenticator works; nothing is
  saved before that.
- **Invites.** An invite link is `/join#<token>`, 24 random bytes in base64url, of which only a hash is
  stored. The token sits after `#`, so it never reaches the server's log or a `Referer`; the page sends it
  in the body. A link works once, for 7 days, and the admin can turn it off before it is used. Joining is two
  steps like setup, with nothing saved before a code proves the authenticator works, and the invite is spent
  in the same transaction that adds the person, so two people cannot join on one link. A wrong or used link
  counts as a failed attempt.
- **Password.** argon2id with 64 MiB of memory, 3 passes and a 32-byte tag, stored as
  `argon2id$<salt>$<hash>` in base64url.
- **Authenticator.** TOTP per RFC 6238: SHA-1, six digits, 30-second steps, one step of clock drift either
  way. A code is accepted once: a step at or before the person's last accepted one is a replay. That step is
  stored with the person, so a restart does not open a used code again.
- **Attempts.** Five wrong attempts from one address lock it out for 15 minutes. A global limit of 50 caps
  guessing spread over many addresses and is high enough that someone mistyping never trips it. Name,
  password and code are all always checked, an unknown name against a decoy hash so it takes as long, and the
  answer does not say which one failed.
- **Sessions.** A random token in an `HttpOnly`, `SameSite=Strict` cookie, valid 30 days, tied to one person.
  Only its hash is stored, so a copy of the database cannot be used to sign in.
- **Exchange keys.** Stored sealed with AES-256-GCM. The 32-byte key is `DATA_DIR/secret.key`, created on first
  use with mode 0600; the database and its backups hold only sealed values, so a copy of the database alone does
  not reveal a key. Moving the server needs that file too, or the exchanges have to be added again. A key is
  checked to be read-only before it is stored.
- **Shared links.** See Sharing above for exactly what a link opens without a session. Links carry no
  amounts unless whoever made them adds them, and every logo request is checked against the link's own rows.
- **Requests.** A request that changes something must come from this origin, so a page on another site
  cannot act with a signed-in person's cookie. Behind the reverse proxy, the client address and protocol come from
  its forwarding headers (`TRUST_PROXY=1`).
- **Content.** The content security policy allows scripts only from this origin; inline styles are allowed
  because the chart library styles its tooltip inline. Static files come from a fixed list; nothing is read
  by request path. The page builds every element by hand and never uses `innerHTML`: token names and
  symbols come from public chains and can contain anything.
- **Secrets in errors.** HTTP error text carries only the host and the response body, never the query string
  or headers, which can contain keys and signatures.
- **Addresses.** Full wallet addresses stay on the server; the page gets a shortened form.
- **Shutdown.** On SIGTERM the server closes cleanly, so the database is not cut off mid-write.

## The page

No build step: plain HTML, CSS and ES modules. ECharts and the font are served from `node_modules`.

- **Loading, empty and first read.** The page has four states, set on `<body data-state>`:
  - `loading`, before the first answer: every block already holds a skeleton of its own shape in the HTML (the
    net worth, the facts, three account chips, the strip, legend, notes, chart, table rows, cards), so the layout
    does not jump when data arrives and the skeleton shows even before the script has loaded;
  - `empty`, with no account yet: the numbers and tabs are hidden and an onboarding screen offers _Add a wallet_
    or _Add an exchange_ (each opens the dialog in that mode) and says what happens next;
  - `reading`, while the first update of a new setup runs: skeletons stay where balances will go, the line under
    the net worth names the account being read, and accounts not read yet are not flagged as problems;
  - `ready`.
    The summary and the views fade in when the state changes, except with reduced motion, and skeletons do not
    shimmer then. Past the first read, empty places say when they fill: the 24-hour, 7-day and 30-day changes count
    down from when history began (`historySince` in `/api/portfolio`), the history chart says when the next update
    is due, and the overview says why there are no balances when accounts exist but none could be priced.
- **Core components.** `public/common/ui.js` is the one place controls are built, for the dashboard and the shared
  page alike: `h` (elements, never `innerHTML`), `icon` and `iconButton`, `button` in four variants
  (primary for the one main action of a view or dialog, secondary, ghost for quiet actions, danger for removal), `select` (a listbox that replaces the native select: arrow keys, Home, End,
  Enter, Space and Escape, `aria-activedescendant`, closes on Tab), `help` (a question-mark button opening a
  short explanation with a link to its source), `checkbox` and `segmented`. Popovers use the browser's
  Popover API, are placed under their trigger (or above it when there is no room) by script, and close on
  scroll, resize and when the view changes.
- **Explanations and sources.** Every reading that is not obvious carries a help button: Fear & Greed
  (alternative.me), RSI and the 200-day average (StockCharts ChartSchool), funding (Binance), open interest
  (Wikipedia) and heat (the Signals view). The Signals view opens with the heat scale, its zones and the weight of
  each reading, taken from `heat` in `config.json`.
- **Signals view.** The heat scale doubles as the summary: under each zone, the share of the portfolio in it
  and how many assets. Clicking a zone shows only its assets. A sentence above says how much is overheated, warm
  and cold, and how much has no readings (stablecoins and tokens without a Binance market). Below, one row per
  scored asset with its heat and each reading, hottest first. A reading that is overheated or cold on its own is
  coloured, so the reason for a score is visible without a list of tags.
- **Fear & Greed** is coloured by its band, following alternative.me's: under 25 extreme fear (teal), under 45
  fear, under 56 neutral, under 76 greed (amber), above extreme greed (orange), so it reads like the heat scale.
- **Where an asset is held** lists places worth at least half a cent; the rest are counted in one line.
- **Views** are held by the page, and the URL hash only mirrors the open one with `history.replaceState`: it
  keeps the view across a reload, but switching adds no history entry, so the back button or a back swipe on a
  trackpad or phone leaves the page instead of cycling through views. The hash is read once, when the page
  opens. After that only a tab, the arrow keys or a link to a view (_How heat is scored_) switch the view, and
  such a link is handled by script, since following it would add a history entry. A browser tab may still hold
  entries with a view in the hash, pushed by a version that added one per switch or by an address typed by
  hand. Going back or forward through them used to flip the views in the order they were once open, so now the
  hash is put back to the open view and the view stays. The page also sets `overscroll-behavior-x: none`, so a
  sideways scroll does not start a back swipe by accident. No element id equals a view name, so a hash never
  scrolls to an anchor. Switching from deep in a view scrolls to where the tab bar sits in the page, computed
  rather than with `scrollIntoView`, which treats a stuck sticky element differently from one browser to
  another.
- **Text** joins clauses with full stops, not semicolons, and lists reasons as separate tags.

- **Header.** The header holds only Settings. Adding a wallet or an exchange starts from the dashed chip at the
  end of the account chips (and from the Accounts view), next to what it adds to, so it is not mistaken for
  adding a user.
- **Account chips.** `/api/portfolio` lists accounts largest first, so the chips and the Accounts view share one
  order. The summary shows the ten largest and folds the rest into an "N more" chip that switches to the
  Accounts view and scrolls to it, so a long list of small wallets does not push the views down. An account
  that is not read yet or out of date keeps its chip whatever its size, since it needs a look, and a new
  account, worth nothing until read, would otherwise vanish the moment it is added. On a phone the chips are
  tiles in two equal columns with the amount at the right edge, so ten accounts take five even rows instead of
  ragged lines, and _Add wallet or exchange_ spans both columns.
- **Settings panel.** The Settings button in the header opens a panel from the right with the privacy switch,
  the shared links (copy, open, turn off), the update schedule and whether an update is possible now, the
  Zerion allowance, for the admin the people (invite, remove, pending invites), and the
  session with who is signed in, the name to sign in with (anyone can change theirs, if no one else has it)
  and sign-out. A new invite link is copied at once and shown once, since only
  its hash is kept.
- **Hidden amounts.** One setting per person, stored on the server (`hide_amounts` in `users`), so it holds
  on every device. It turns dollar amounts and quantities into dots: the net worth, account chips,
  allocation legend and tooltips, history axis and tooltip, positions, where-held rows, DeFi and accounts.
  Shares, changes, prices and heat stay. The eye next to the net worth flips the same setting. It is about a
  screen being seen, not a security boundary: the API still returns amounts to the signed-in person. The share
  dialog starts with amounts off while they are hidden.

- **Views.** Overview, Positions, Signals, DeFi and Accounts share one tab bar; the view lives in the URL
  hash. The bar sticks to the top and shows the net worth at its right end once the large figure scrolls away. The
  tabs never move: the figure takes space only on the right, so a tab cannot slide from under the pointer when
  the bar sticks or unsticks. The bar is opaque, so nothing shows through it. A short view stays as
  short as its content: switching to it from deep in a long one may unstick the bar, which is harmless now that
  the tabs do not move. Arrow keys move
  between tabs. Switching from deep in a long view opens the next one at its start. The history chart is
  resized when the overview is shown, because a chart drawn while hidden has no size.
- **Progress.** While an update runs, the page asks `/api/progress` every second and shows each account's
  state on its chip and the account being read under the net worth. Logos and categories of new tokens arrive
  after an update, so the page reloads its data 20 seconds later.
- **Updates of the server.** `/api/portfolio` carries a stamp of the page's own files. A tab left open across
  a deploy sees the stamp change and reloads, instead of running old code against new answers.
- **Notices.** Problems are grouped by cause, one notice per cause rather than per account. Only allowance
  notes and failures are shown; routine warnings such as unpriced spam stay in the Accounts view. A chip
  gets a clock when some of its balances are older than two scheduled updates.
- **Colour.** Eight categorical hues validated for the dark surface are used in a fixed order, and a ninth
  group is "Other". Colour follows the group, not its rank, so a category keeps its hue whatever its size.
  The allocation strip folds groups under 0.5% into "Other". Bands in the history chart get a
  surface-coloured edge, so neighbours stay apart without relying on hue. The heat badge spells out its zone,
  so colour is never the only cue.
- **Allocation** is net, like the positions and the history chart: a loan is subtracted from every group it
  belongs to (a USDC loan from Stablecoins, from USDC, and from its chain, account and kind), so the groups add
  up to the net worth and each share is of the net worth. A strip can only divide what is held, so it shows the
  groups worth more than zero, in proportion to each other. A group that owes more than it holds, such as a
  borrowed token that was swapped away, is listed after them with a negative amount and share and an outlined
  swatch, and never folds into "Other", so a loan stays visible. When the net worth is not above zero, shares
  are of what is held instead.
- **Chart labels.** The chart measures axis labels on a canvas and draws them in SVG. Both get the same
  system font list, plus 10 pixels to spare, or the first character of a wide label is cut off.
- **Ordering.** Signals list the largest holdings first: an overheated 10% position matters more than an
  overheated 0.5% one. Positions under a dollar are hidden until asked for; share bars are scaled to the
  largest position.
- **QR code.** Dark on light whatever the page theme, because phone cameras read inverted codes poorly.

## Database

One SQLite file, `DATA_DIR/stashboard.db`. Each migration in `src/storage/database.ts` upgrades the schema by one version,
and `PRAGMA user_version` records how many have run.

| Table               | Holds                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `users`             | People: name, password hash, authenticator secret and last used step, admin, hidden amounts |
| `invites`           | Hashes of invite tokens, who made them, and when they expire                                |
| `accounts`          | Each person's wallets and exchanges; an exchange is an account like any wallet              |
| `snapshots`         | One row per collection run                                                                  |
| `snapshot_accounts` | Each account's result in a run: ok with warnings and reported total, or error               |
| `holdings`          | Positions per account and run; `read_at` when it comes from an earlier answer               |
| `signals`           | Market readings and heat score per asset, with the Binance market used                      |
| `sessions`          | Hashes of session tokens, whose they are, and their expiry                                  |
| `settings`          | The imported config key and when the Zerion chain list was fetched                          |
| `logos`             | Where each logo comes from, its stored file, and when it was last tried                     |
| `asset_categories`  | Categories looked up, with the coin's tags                                                  |
| `user_categories`   | Categories each person chose by hand                                                        |
| `exchange_keys`     | Per exchange account: the last four characters of its API key and the sealed key and secret |
| `shares`            | Shared links: token, whose, when made, when they expire, and the frozen snapshot            |
| `zerion_cache`      | The last Zerion answer per wallet and kind of read                                          |

Snapshots are shared: one run holds every person's reads, and `snapshot_accounts` says whose account each
read is. Migration 11 brought people in: the single owner and their hidden-amounts setting became person 1,
the admin, named `admin`, and every account, session, link and hand-chosen category became theirs. An owner
who had already signed up keeps the name `admin` and signs in with it; one who had not picks a name at setup. A migration that rebuilds a table runs with foreign keys off, as SQLite requires, and is
checked with `PRAGMA foreign_key_check` before it commits.

Removing a wallet removes its history with it. Once a day, at start and then checked hourly, the database is
copied with `VACUUM INTO`, which takes a consistent copy while it is in use; the newest 14 copies are kept.

## Install, deploy and CI

`install.sh` is the one place that brings a server up, whether it runs there by hand or is called by
`deploy.sh`:

- checks for Docker, Compose, and that the user may use Docker;
- without `config.json`, asks in the terminal for the host name and the keys (validated by pattern, so the
  JSON it writes needs no escaping) and writes it with mode 600; without a terminal it stops and says what to do;
- writes `.env` with the domain for Caddy, and warns when the host name does not resolve to an address of this
  machine (fine behind NAT, a mistake otherwise);
- makes `config.json` readable by the container's `node` user (uid 1000): owned by it when run as root, mode 644
  with a warning otherwise;
- builds the image and runs the key check in a throwaway container. A failing source is reported but does not
  stop the install, since a third-party outage must not block shipping a fix;
- starts the containers, waits up to 90 seconds for the health check, and prints the address and, while no
  account exists, the setup code from the log.

Run again, it updates: nothing is asked because `config.json` exists. `deploy.sh` copies the sources (after
removing the old ones, so deleted files do not linger), `config.json` when the machine running it has one, and
`install.sh`, then runs `install.sh` on the server with `/dev/null` as input, since the SSH session must not
feed it anything. From CI, which has no `config.json`, the server's copy is kept.

CI (`.github/workflows/ci.yml`) checks formatting, types, tests and the shell scripts' syntax on every pull
request and push to `main`. The deploy workflow (`.github/workflows/deploy.yml`) runs on pushes to `main` but
deploys only when the pushed commit belongs to a merged pull request into `main`, which it asks the GitHub API
(`/commits/<sha>/pulls`). That works the same for merge, squash and rebase merges and for pull requests from
forks, whose own events never see the deploy secrets. A commit pushed straight to `main` is checked but not
deployed. It can also be started by hand. It stays off until `DEPLOY_HOST` is set, so forks do not try to
deploy, and it runs the checks again before deploying.

The image runs TypeScript directly on Node 24, so there is no build step; the config is mounted from the
host, and other entry points run the same way (`docker compose run --rm stashboard src/cli/check.ts`). The app
publishes no port: only Caddy reaches it on the compose network. The image is built on the server, so a
Watchtower running there is told to leave it alone. Caddy obtains and renews the HTTPS certificate, which
needs ports 80 and 443 reachable from the internet.

## Demo

`npm run demo` (`src/cli/demo.ts`) writes a made-up portfolio into `data-demo` and starts the server on it with
`DEMO=1` and `config.example.json`. The data is deterministic: four accounts (an exchange, an EVM wallet with
an Aave deposit and loan, a Solana wallet with Jito staking, a TON wallet), 90 days of snapshots every six
hours from a seeded random walk ending at fixed prices, a few quantity changes so the history moves, and
signals in all four zones. The addresses are test vectors or random bytes, not anyone's wallet.

In demo mode the server never collects: no schedule, no collection on start, the update gate is closed with a
reason, and adding or removing accounts, inviting or removing people, and collecting answer 403. Logos are still
fetched, so the demo looks like the real thing when online. The page shows a dismissible notice that the data
is not real. The README screenshots come from the demo.
