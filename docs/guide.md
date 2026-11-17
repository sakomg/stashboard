# Using Stashboard

## The dashboard

The top of the page is the net worth, the change over 24 hours, 7 and 30 days, the crypto Fear & Greed
index, and the accounts as chips, largest first. Until the history reaches that far back, those changes
are estimates marked **≈**: today's holdings at the prices of 24 hours, 7 or 30 days ago. Their help button says
how much of the portfolio they cover. Where there is nothing to estimate yet, a dash stands in, and hovering it
says when the change appears. A chip spins while its account is being read and shows a
warning when it is out of date. With more than ten accounts, the smaller ones fold into a **more** chip that
opens the Accounts view, but an account that is not read yet or out of date always keeps its chip. **Add
wallet or exchange** is at the end of the chips.

Below, five views:

- **Overview**: allocation as a strip with a legend, grouped by category, asset, chain, account or kind, the
  largest positions, and the history chart.
- **Positions**: every asset with its quantity, price, value, share, changes and heat. RSI and funding are in Signals. Select an
  asset to see every account, chain and protocol it is held in. Click its category to change it.
- **Signals**: the heat of the portfolio and of each asset.
- **DeFi**: positions in protocols, net of loans. The tab shows only when there are any.
- **Accounts**: every wallet and exchange, with its status and warnings, to rename or remove.

**Settings** (top right) has privacy, shared links, update status, people for the admin, and the session.

Balances update on their own, as often as Zerion's free allowance lets them (see
[Free-tier limits](#free-tier-limits)). The button next to the update time asks for one now. While it is greyed
out, hovering it says why and when it comes back.

## Heat score

Every asset with a Binance market gets a heat score from 0 (cold) to 100 (overheated). It blends five
readings, each scored 50 at its neutral value and 80 at its overheated threshold:

| Reading                                 | Weight | Neutral | Overheated |
| --------------------------------------- | ------ | ------- | ---------- |
| Daily RSI(14)                           | 30%    | 50      | 70         |
| Weekly RSI(14)                          | 25%    | 50      | 75         |
| Funding rate, 3-day average, per 8 h    | 20%    | 0.01%   | 0.03%      |
| Price against its 200-day average       | 15%    | 0%      | +50%       |
| Open interest over 7 days, price rising | 10%    | 0%      | +30%       |

Under 30 is cold, 30 to 60 neutral, 60 to 80 warm, 80 and above overheated. A reading that does not exist for
an asset (no perpetual contract, a short price history) hands its weight to the others; tokenized stocks use
RSI and the average only. Weights, thresholds and zones are set under `heat` in `config.json`.

The Signals view says how much of the portfolio sits in each zone, and lists every scored asset with its
readings. A reading that is overheated or cold on its own is coloured. Every reading has a help button with an
explanation and a link to its source.

When something you hold turns overheated, a notice under the accounts says which assets and how much of the
portfolio they are. _Show in Signals_ opens the view with only the overheated assets, and _Dismiss_ hides the
notice on every device you sign in on. An asset that dips into warm and comes back stays dismissed. One that
cools to neutral or cold and then overheats again brings the notice back.

This describes market conditions. It is not advice to buy or sell.

## Assets and categories

[`assets.json`](../assets.json) decides how holdings are merged and grouped: which wrappers count as the same
asset (WETH and stETH as ETH), which category an asset belongs to, and which tickers are stocks. Tokenized
stocks are matched by suffix, so `NVDAx`, `NVDAB` and `NVDAon` all count as NVDA. Aave deposit receipts count
as the token that was lent: `aEthWETH` is ETH. TON, the coin's name until its 2026 rename, counts as GRAM.

An asset the file does not mention is looked up on CoinGecko by ticker, and the coin's tags decide its
category. When the lookup is wrong or finds nothing, click the category next to the asset in Positions and
choose one. A category chosen by hand wins over the file and the lookup.

## Privacy

The eye next to the net worth, or **Hide amounts** in Settings, turns every dollar amount and quantity into
dots on every device. Shares, changes and prices stay. It is meant for screens other people can see.

Logos are downloaded by your server and served from it, so your browser never tells a third party which
tokens you hold.

## Sharing

**Share** in Allocation makes a picture of the allocation to copy, download or send, grouped any way the
strip can be. It can also make a link: a snapshot anyone with the link can open without signing in, for 1, 7
or 30 days. Amounts are left out unless you tick **Show amounts**. Settings lists the links and turns them
off.

## History

Every update adds a point to the history. An account joins the history when it is first read, so accounts
added one at a time show as steps in the chart.

## Free-tier limits

The tightest limit is Zerion's free key: three requests a second, 2,000 a day, and a quarter of the day's
allowance for reads of DeFi positions. Stashboard reads the allowance from Zerion's answers and spaces updates
so a whole day of them fits in it: the more EVM and Solana wallets, the longer the gap, never under 10 minutes. Settings
shows how many updates a day the key allows and how often DeFi positions are read. Until the gap has passed,
**Update now** is greyed out and says when it comes back. A wallet or exchange you add is read straight away on
its own, without waiting and without reading everyone else's. When Zerion refuses, the last answer is used and
the dashboard says how old it is.

## Signing in

The first account is created on the first visit with the setup code the server prints: a name, a password and
an authenticator app. Its owner is the admin. Anyone can change the name they sign in with: the pencil next to it under
Session in Settings. Five wrong attempts from one address lock it out for 15 minutes,
and each authenticator code works once. To reset it, see [troubleshooting](self-hosting.md#troubleshooting).

## Friends

The admin can let friends keep their own portfolio on the same server: _Invite someone_ under People in
Settings copies a link that works once, for 7 days. Until it is used, the copy button on its row copies it
again. The friend opens it, picks a name and a password and adds
an authenticator, and from then on signs in like anyone else. Each person sees only their own accounts,
history, categories chosen by hand and shared links. Updates read everyone's accounts together, with the one
Zerion key in `config.json`, so more wallets use the daily allowance faster. Whoever runs the server can read
its database, so friends should trust them. Removing a person deletes everything they added.

Running on your own computer with `npm start`, the dashboard listens on localhost only and stays open until
you create an account at `/setup`. Set `REQUIRE_LOGIN=1` to demand one from the start.
