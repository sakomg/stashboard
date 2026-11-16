# Self-hosting Stashboard

This guide takes you from an empty server to a running dashboard with HTTPS, and covers updating, backups,
moving to another server and the problems people usually hit.

## What you need

- **A Linux server** that is always on: 1 vCPU, 1 GB of memory and 2 GB of disk are plenty. Any VPS works;
  the guide assumes Ubuntu or Debian.
- **Docker** with the Compose plugin.
- **A host name** pointing at the server. A free [DuckDNS](https://www.duckdns.org) subdomain works.
- **Ports 80 and 443** reachable from the internet, for the HTTPS certificate and the dashboard.
- **Free API keys** for the data sources you use (see [API keys](#api-keys)).

## 1. Point a host name at the server

With DuckDNS: sign in, create a subdomain (for example `mystash`), and set its IPv4 address to your server's
public address. If the server has an IPv6 address, set that too, or leave it empty; a wrong IPv6 record breaks
the certificate. The host name is then `mystash.duckdns.org`.

With your own domain, create an `A` record (and an `AAAA` record for IPv6) for a name such as
`stash.example.com`.

Check it from the server: `getent hosts mystash.duckdns.org` should print the server's address.

## 2. Install Docker

Follow the official guide for your system: https://docs.docker.com/engine/install/. On Ubuntu and Debian the
convenience script works:

```sh
curl -fsSL https://get.docker.com | sh
```

If a firewall is on, open the web ports. With `ufw`:

```sh
ufw allow 80/tcp
ufw allow 443/tcp
```

## 3. Install Stashboard

```sh
git clone https://github.com/sakomg/stashboard.git /opt/stashboard
cd /opt/stashboard
./install.sh
```

The installer:

1. asks for the host name and the API keys (press Enter to skip an optional one) and writes `config.json`;
2. checks that the host name points at this machine;
3. builds the image, checks every key against its service, and starts two containers: the app and
   [Caddy](https://caddyserver.com), which obtains and renews the HTTPS certificate;
4. waits until the app is healthy and prints the address and a **setup code**.

## 4. Create your account

Open `https://your-host/setup` and:

1. enter the setup code. It proves the server is yours, so whoever finds the address first cannot claim it.
   The server prints it in its log on every start until the account exists:
   `docker compose logs stashboard | grep setup-code`;
2. choose a password of at least 12 characters;
3. scan the QR code with an authenticator app (any TOTP app works) and enter one code.

From then on every page needs a sign-in. Sessions last 30 days.

## 5. Add your accounts

Use **Add wallet or exchange** on the dashboard.

- **Wallets**: paste a public address. The network (EVM, Solana or TON) is recognised from the address. One
  EVM address covers every EVM chain and DeFi protocol Zerion knows, and Lighter.
- **Exchanges**: Binance, Bybit or OKX, with an API key that can only read. See [Exchange keys](#exchange-keys).

The first update starts as soon as an account is added and usually takes under a minute.

## API keys

All of them are free.

| Service   | Needed for                                    | Where                                                                |
| --------- | --------------------------------------------- | -------------------------------------------------------------------- |
| Zerion    | EVM and Solana wallets                        | [developers.zerion.io](https://developers.zerion.io)                 |
| TonAPI    | TON wallets. Works without a key, much slower | [tonconsole.com](https://tonconsole.com)                             |
| CoinGecko | Fallback prices, logos, categories. Optional  | Demo key at [coingecko.com/en/api](https://www.coingecko.com/en/api) |

The keys live in `config.json` on the server, which git ignores. To change one, edit the file and run
`./install.sh` again.

### Exchange keys

Every exchange is added on the dashboard under **Add wallet or exchange**, **Exchange**. Stashboard reads the
key's permissions before saving it and refuses a key that can trade, transfer or withdraw, naming the
permissions to turn off. The secret, and the OKX passphrase, are encrypted before they are stored, and the page
only ever shows the last four characters of the key.

**Binance.** Open **API Management**, create a **System generated** key, tick **Enable Reading** only, and
restrict it to **trusted IPs** with your server's public address.

**Bybit.** Open **API**, create a **System-generated** key with **Read-Only** permissions, tick every box it
offers (they only allow reading, and Funding and Earn are read only with them), and bind it to your server's
public address. A key without an IP address expires after three months. A key from Bybit's regional sites
(Turkey, Kazakhstan, Georgia, UAE, Indonesia) works too: the site that issued it is found when it is added.
Bybit EU keys are not supported, since its API is open only to brokers.

**OKX.** Open **API**, create a key with only the **Read** permission, bind it to your server's public address,
and keep the passphrase you set: the dashboard asks for it. Keys from my.okx.com (EEA) and app.okx.com (US) work
too, and are recognised by themselves.

## Configuration

`config.json`:

| Key                        | Meaning                                         | Default                              |
| -------------------------- | ----------------------------------------------- | ------------------------------------ |
| `zerion.apiKey`            | Zerion key                                      |                                      |
| `tonapi.apiKey`            | TonAPI key                                      |                                      |
| `coingecko.apiKey`         | CoinGecko demo key                              |                                      |
| `domain`                   | The host name the dashboard is served on        |                                      |
| `schedule.balancesMinutes` | How often balances are read, at least 5         | 60                                   |
| `schedule.signalsMinutes`  | How often heat signals are recomputed           | 240                                  |
| `heat`                     | Weights, thresholds and zones of the heat score | see [the guide](guide.md#heat-score) |

[`assets.json`](../assets.json) decides how holdings are merged and grouped; see
[the guide](guide.md#assets-and-categories).

A `binance` block with `apiKey` and `apiSecret`, from setups that predate adding exchanges on the page, is
imported once on start and can then be deleted.

## Updating

```sh
cd /opt/stashboard
git pull
./install.sh
```

The database is migrated on start. The page reloads itself when it notices the new version.

## Backups

Once a day the app copies the database to `backups/` inside its data volume and keeps the last 14. That covers
a bad update or a damaged file, not a lost server, so copy the backups off the machine now and then, together
with the key that encrypts exchange secrets:

```sh
docker compose cp stashboard:/data/backups ./backups
docker compose cp stashboard:/data/secret.key ./secret.key
```

Keep `secret.key` somewhere safe: with a backup it unlocks the stored exchange keys. A backup restored without
it keeps everything except the exchange keys, which you then add again.

### Restoring or moving to another server

1. Install Stashboard on the new server as above, then stop the app: `docker compose stop stashboard`.
2. Put the backup and the key in the Stashboard folder as `restore/stashboard.db` and `restore/secret.key`, and
   copy them into the data volume with the right owner:

   ```sh
   docker compose run --rm --no-deps -u root --entrypoint sh -v "$PWD/restore:/restore:ro" stashboard -c \
     'cp /restore/stashboard.db /data/stashboard.db && cp /restore/secret.key /data/secret.key &&
      rm -f /data/stashboard.db-wal /data/stashboard.db-shm &&
      chown node:node /data/stashboard.db /data/secret.key && chmod 600 /data/secret.key'
   docker compose start stashboard
   ```

3. Point the host name at the new server. If an exchange key is restricted to the old address, add the new
   one on the exchange.

## Deploying from your own computer

Instead of cloning on the server, you can keep the repository on your computer and push it:

```sh
./deploy.sh root@your-server            # SSH_PORT=2222 ./deploy.sh root@your-server for another port
```

It copies the project and your `config.json` to `/opt/stashboard` and runs `install.sh` there.

### Continuous deployment from a fork

The workflow in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) deploys every pull request
merged into `main`, and can be started by hand. A commit pushed straight to `main` is not deployed. It stays
off until the repository has these settings under _Settings → Secrets and variables → Actions_:

| Kind     | Name                 | Value                                                                |
| -------- | -------------------- | -------------------------------------------------------------------- |
| Variable | `DEPLOY_HOST`        | Server address. Deploys stay off until this is set                   |
| Variable | `DEPLOY_USER`        | SSH user, default `root`                                             |
| Variable | `DEPLOY_PORT`        | SSH port, default `22`                                               |
| Variable | `DEPLOY_DIR`         | Remote directory, default `/opt/stashboard`                          |
| Secret   | `DEPLOY_SSH_KEY`     | Private key of a deploy-only SSH key pair                            |
| Secret   | `DEPLOY_KNOWN_HOSTS` | Optional: output of `ssh-keyscan <host>`, pins the server's host key |

The pipeline never sees `config.json`. Install once with `./install.sh` on the server or `./deploy.sh` from
your computer; later deploys keep the server's copy.

## Command line

On the server, prefix the commands with `docker compose run --rm stashboard`, for example
`docker compose run --rm stashboard src/cli/check.ts`. Locally, use npm:

| Command                        | What it does                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `npm run check`                | Calls every source once and reports which keys and accounts work       |
| `npm run collect`              | Reads every account, stores a snapshot and prints the portfolio        |
| `npm run collect -- --show`    | Prints the stored portfolio without calling any API                    |
| `npm run collect -- --signals` | Recomputes and prints the heat signals                                 |
| `npm run wallets`              | Lists wallets; `-- add <address> [label]` and `-- rm <id>` change them |
| `npm run auth:reset`           | Removes the account so it can be set up again                          |

## Troubleshooting

**The browser says the connection is not private, or the site does not load.** Caddy could not get a
certificate yet. Check that the host name points at the server (and that there is no wrong `AAAA` record), that
ports 80 and 443 are open, and read `docker compose logs caddy`.

**I lost the setup code.** Restart the app and read it again:
`docker compose restart stashboard && docker compose logs stashboard | grep setup-code`.

**I forgot the password or lost the authenticator.** Remove the account and set it up again. History and
accounts are kept:

```sh
docker compose run --rm stashboard src/cli/auth-reset.ts && docker compose restart stashboard
```

**The exchange refused the key.** The key, the secret or, for OKX, the passphrase is wrong, or the key does not
allow the server's IP address. When the exchange says which, the message says so. Bybit also refuses servers in
the US.

**An account says it is out of date.** Its source failed on the last update; the notice says why, and the last
good balances are shown meanwhile. Zerion's free allowance is the usual cause. The settings panel shows how
much of it is left today.

**The update button is greyed out.** It rests for a minute after an update, and while Zerion's daily allowance
is used up. Hovering it says which.

## Uninstalling

```sh
cd /opt/stashboard
docker compose down          # stops the containers, keeps the data
docker compose down -v       # also deletes the database, the keys and the certificates
```
