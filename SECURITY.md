# Security

Stashboard holds a picture of someone's wealth and, for exchanges, an API key. It is built so that neither can
be used to move money, and so that the dashboard is safe to expose to the internet.

## The model in short

- **Nothing can move funds.** Wallets are public addresses. An exchange key is checked with the exchange
  before it is saved and refused if it can trade, transfer or withdraw.
- **Exchange secrets and pending invite links are encrypted at rest** with AES-256-GCM under a key file kept
  next to the database (`secret.key`, readable by the app only). The page only ever sees the last four characters of a key.
- **Each person, two factors.** A name, a password (argon2id) and an authenticator code, each code accepted
  once. Five wrong attempts from one address lock it out for 15 minutes.
- **First run cannot be hijacked.** Until the admin's account exists, a server reachable from other machines
  serves only the setup page, and creating it needs a code printed in the server's log.
- **Nobody joins uninvited.** Other people join only through a one-time link the admin makes, and each sees
  only their own accounts, history and links. The board shows everyone's portfolio to the others without their
  name, account names or addresses, and anyone can leave it.
- **Sessions** are random tokens in `HttpOnly`, `SameSite=Strict` cookies, stored only as hashes.
- **The page** allows scripts only from its own origin, builds every element without `innerHTML`, and refuses
  requests that change something when they come from another site.
- **Logos and market data** are fetched by the server, so the browser never tells a third party what the
  portfolio holds.
- **Shared links** open a frozen snapshot without amounts unless whoever made them adds them, expire after at
  most 30 days, and can be turned off.

The details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security).

## What it does not protect against

Someone with root on your server can read the database and the key file together, so the people on a server
trust whoever runs it with their balances and exchange keys. Hide amounts is for screens other people can see;
it does not hide anything from the API of the signed-in person. Keep the server patched,
and keep backups of `secret.key` as private as the backups themselves.

## Reporting a vulnerability

Please do not open a public issue. Use **Report a vulnerability** on the repository's _Security_ tab, which
sends a private advisory to the maintainers. Include what you found, how to reproduce it, and what an attacker
could do with it. You will get an answer within a week.

Only the latest release is supported.
