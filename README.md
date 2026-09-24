# Clash Royale Companion

A self-hosted companion app for Clash Royale. It links your player tags, pulls your profile and battle log
from Supercell's official API once a day, and keeps the history in SQLite. The in-game battle log forgets
anything older than about 25 matches, but this app does not. You get win rates by deck and mode, trophy
history, a card collection view with upgrade progress, and a place to save decks.

It is also built for AI assistants. Each user can create API keys, and a ready-made skill teaches Claude, or
any agent that can make HTTP calls, to load your real account data before giving advice. The assistant can
save the decks it proposes back to the app. The app is invite-only and multi-user, and it runs as a single Bun
process in one Docker container.

## Features

**Web pages**

- A player switcher in the header: with several linked tags, every page shows the one you picked.
- Dashboard with trophies, Path of Legend, recent form, and a manual sync button.
- Battle history with filters; click a battle to see both decks in a dialog (or on its own page).
- Card collection with levels, upgrade-ready cards, and the copies and gold needed for the next level and
  for max level.
- Deck builder with average elixir, and a level check against your collection.
- Settings to link player tags, keep notes per player, manage API keys, and change your username or password.

**JSON API** under `/api`

- Players, battles, stats, cards, notes, decks, and on-demand sync.
- `GET /api/players/{tag}/context.md` returns one Markdown document with everything an assistant needs.
- Admin endpoints for invites and users, protected by admin tokens created with the CLI.

**AI skill** in [`.claude/skills/`](docs/ai-skill.md)

- Drop-in skill for Claude Code and the Claude apps, with the full endpoint reference and coaching rules.

## Docs

- [`docs/architecture.md`](docs/architecture.md): code layout, conventions, auth, repository API, sync and test setup. Read this before changing code.
- [`docs/ai-skill.md`](docs/ai-skill.md): installing and configuring the AI skill.
- [`.claude/skills/clash-royale-companion/SKILL.md`](.claude/skills/clash-royale-companion/SKILL.md): the skill itself, with the full endpoint reference.

## Screenshots

_Coming soon._

## Quick start (local)

You need [Bun](https://bun.sh) 1.4 or newer.

### Without a Supercell key (mock API)

The mock server replays the fixtures in `test/fixtures` for any player tag.

```sh
bun install
cp .env.example .env              # no changes needed for the mock API
bun run mock-api                  # terminal 1: fake Clash Royale API on :8787
CR_API_BASE=http://localhost:8787/v1 CR_API_TOKEN=dev bun run dev   # terminal 2
bun run seed-dev                  # creates user dev / Local-Tester-2026 and prints an invite code
```

Open http://localhost:3000, log in as `dev`, and link any valid tag such as `#9QJUGC2R` on the Settings page.

### With a real key

```sh
bun install
cp .env.example .env              # set CR_API_TOKEN
bun run cli invite create         # prints an invite code (1 use, expires in 7 days)
bun run dev
```

Open http://localhost:3000/register, use the invite code, then link your tag on the Settings page.

Other useful commands:

```sh
bun test                # all tests, in-memory database
bun run typecheck
bun run cli --help      # admin CLI: invites, users, admin tokens, sync, retention, stats
```

## Getting a Supercell API key

1. Sign in at [developer.clashroyale.com](https://developer.clashroyale.com) with a Supercell ID.
2. Open **My Account** and choose **Create New Key**.
3. Under **Allowed IP addresses**, enter the public IPv4 address of the machine that will call the API.
   On a VPS, find it with `curl -4 ifconfig.me`.
4. Copy the token into `CR_API_TOKEN`.

A key only works from its allowlisted IPs. Calls from anywhere else fail with 403 "accessDenied".

On a home connection with a changing IP, use the RoyaleAPI proxy instead:

1. Create a key that allows `45.79.218.79`, the proxy's IP.
2. Set `CR_API_BASE=https://proxy.royaleapi.dev/v1`.

## Deploy on Coolify

Coolify can build this repository with its **Dockerfile** build pack or its **Docker Compose** build pack.
Both use the same image.

### Option A: Dockerfile build pack

1. In your project, choose **New Resource**, then your Git source: a public repository, the GitHub App, or a
   deploy key.
2. Pick the branch, set **Build Pack** to **Dockerfile**, and set **Dockerfile Location** to
   `/deploy/Dockerfile`.
3. Under **General**:
   - Set **Ports Exposes** to `3000`.
   - Set **Domains** to your URL, for example `https://cr.example.com`.
4. Under **Environment Variables**, add:
   - `CR_API_TOKEN`: your Supercell key, allowlisted for the server's public IP.
   - `APP_URL`: the same URL as the domain. This turns on secure cookies and the CSRF origin check behind
     Coolify's TLS proxy.
   - `PORT`: `3000`. Leave it at the default.
5. Under **Persistent Storage**, add a volume mount with destination path `/data`. The database lives at
   `/data/app.db`. Without this volume, every redeploy wipes all data.
6. Leave Coolify's **Health Checks** disabled. Coolify probes with curl or wget, which the slim Bun image
   doesn't ship, so the app gets marked unhealthy and restarted. The image's own Docker `HEALTHCHECK`
   already probes `/api/health` using Bun.
7. Click **Deploy**.

### Option B: Docker Compose build pack

1. Choose **New Resource** and your Git source, then set **Build Pack** to **Docker Compose**. The compose
   file is `/docker-compose.yml`.
2. Coolify lists every variable the compose file references. Fill in `CR_API_TOKEN` and `APP_URL`.
   The rest have defaults.
3. Set the domain of the `app` service to `https://cr.example.com:3000`. The `:3000` suffix tells Coolify's
   proxy which container port to use, and the public URL stays on 443.
4. Remove the `ports:` mapping from `docker-compose.yml` if you don't want port 3000 open on the host.
   The proxy doesn't need it.
5. The `cr-data` named volume is created and kept across deploys automatically. Deploy.

### Option C: Prebuilt image with `deploy/deploy.sh`

This is how the maintainer's instance runs. Coolify pulls `ghcr.io/cgycgy/clash-royale-agent` instead of
building from Git.

1. Copy `deploy/.env.deploy.example` to `deploy/.env.deploy` and fill in the Coolify URL, API token,
   and the app UUID and webhook URL of a **Docker Image** application.
2. Attach a persistent volume at `/data` to that application and set the environment variables above.
3. Run `bash deploy/deploy.sh`. It builds `deploy/Dockerfile`, pushes the image to GHCR and asks Coolify
   to redeploy. You need `docker login ghcr.io` first.

### First run

1. In Coolify, open the application's **Terminal** tab and connect to the container.
2. If you want to use the [admin API](#admin-api) from outside the container, create an admin token and
   store it somewhere safe. It is printed once.

   ```sh
   bun run cli admin-token create --name laptop
   ```

3. Invite yourself:

   ```sh
   bun run cli invite create
   ```

   The code allows one sign-up and expires after 7 days. Pass `--days N` to change that, or `--no-expiry`.
   To add yourself without an invite, run `bun run cli user create <name> <password>` instead.
   Passwords need 12–128 characters mixing at least 3 of lowercase, uppercase, digits and symbols, must not
   contain the username, and can't be a well-known common password.
4. Open `https://cr.example.com/register` and sign up with the invite code.
5. On **Settings**, link your player tag. The first sync runs right away, and then it runs daily (see `SYNC_CRON`).
6. On **Settings**, create an API key for your AI assistant.

The card catalog loads at startup. If `CR_API_TOKEN` is wrong or the IP is not allowlisted, the log shows
`card catalog sync failed ... denied access`. The app still starts, and the catalog is retried daily at
04:17 UTC or on the next restart.

## Admin API

Admin endpoints authenticate with an admin token (`cra_...`) in `Authorization: Bearer`. Admin tokens are
separate from user API keys (`crk_...`): a user key gets 401 on `/api/admin/*`, and an admin token gets 401
on user endpoints. Create one in the container terminal with `bun run cli admin-token create [--name <name>]`.
It is shown once and only its hash is stored. Revoke it with `bun run cli admin-token revoke <id>`.

```sh
URL=https://cr.example.com
A="Authorization: Bearer cra_..."

# Create an invite. Defaults: 1 use, expires in 7 days.
curl -sS -X POST -H "$A" -H "Content-Type: application/json" "$URL/api/admin/invites" \
  -d '{"maxUses": 3, "expiresInDays": 14}'

curl -sS -H "$A" "$URL/api/admin/invites"                 # list invites
curl -sS -X DELETE -H "$A" "$URL/api/admin/invites/4"     # revoke invite 4
curl -sS -H "$A" "$URL/api/admin/users"                   # users with their player tags
curl -sS -H "$A" "$URL/api/admin/sync-runs?limit=20"      # recent sync attempts
curl -sS -X POST -H "$A" "$URL/api/admin/sync"            # sync every player now, in the background
```

## AI assistant setup

See [`docs/ai-skill.md`](docs/ai-skill.md). In short:

1. Copy `.claude/skills/clash-royale-companion` to `~/.claude/skills/` (inside this repo it loads automatically).
2. Set `CR_COMPANION_URL` and `CR_COMPANION_API_KEY`.

Any other agent can follow `.claude/skills/clash-royale-companion/SKILL.md` as plain instructions.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CR_API_TOKEN` | none, required by the server | Supercell API token, bound to an IP allowlist. The CLI needs it only for `sync`. |
| `CR_API_BASE` | `https://api.clashroyale.com/v1` | API base URL. Use `https://proxy.royaleapi.dev/v1` or the local mock. |
| `APP_URL` | unset | Public URL. When it starts with `https://`, session cookies are `Secure`, and its origin passes the CSRF check behind a proxy. |
| `DATABASE_PATH` | `./data/app.db`, or `/data/app.db` in Docker | SQLite file. Its directory is created if missing. |
| `PORT` | `3000` | HTTP port. Keep `3000` in Docker. |
| `SYNC_CRON` | `0 3 * * *` | Schedule for syncing all players, in the server's timezone. Daily at 03:00 by default. Use hourly (`0 * * * *`) if someone plays more than about 25 battles a day, since the API only keeps the last 25. |
| `TZ` | `UTC` | Timezone for the cron schedule, e.g. `Asia/Kuala_Lumpur`. |
| `SYNC_COOLDOWN_SECONDS` | `60` | Minimum gap between manual syncs of one player, from the dashboard button or the API. |
| `SNAPSHOT_KEEP_ALL_DAYS` | `0` (off) | Opt-in thinning. When above 0, snapshots older than this many days are reduced to one per UTC day. |
| `SNAPSHOT_KEEP_DAILY_DAYS` | `0` (off) | Opt-in deletion. When above 0, snapshots older than this many days are deleted. |

Development only:

| Variable | Default | Description |
|---|---|---|
| `MOCK_CR_PORT` | `8787` | Port of `bun run mock-api`. |
| `HOST_PORT` | `3000` | Host port that `docker-compose.yml` publishes. |

## Operations

**Backups.** The database runs in WAL mode, so copying `app.db` alone while the app runs can miss recent
writes. Use one of these:

```sh
# Online, from inside the container. The image has no sqlite3 binary, so use Bun.
bun -e 'new (require("bun:sqlite").Database)("/data/app.db").exec("VACUUM INTO \"/data/backup.db\"")'

# Online, from the host, if sqlite3 is installed there
sqlite3 /path/to/volume/app.db ".backup /backups/app-$(date +%F).db"

# Offline: stop the container, then copy app.db and any app.db-wal file together
```

`VACUUM INTO` fails if the target file already exists. Copy the backup off the server afterwards. The volume path on the host is shown by
`docker volume inspect <volume>`.

**Snapshot history.** Profile snapshots of 20 to 100 KB each are kept forever by default. A sync stores a
new snapshot only when the profile or upcoming chests changed. Otherwise it updates the latest snapshot's
`last_seen_at`, which records the most recent sync that confirmed that state, so an idle player adds no
rows. If you run hourly syncs on a small disk, set the two `SNAPSHOT_KEEP_*` variables above to thin old
snapshots in the daily 04:17 UTC job. The newest snapshot of each player is always kept. Run it by hand with
`bun run cli snapshot prune`. SQLite reuses freed pages, but the file does not shrink until you run `VACUUM`.
Battles are never pruned.

**Monitoring.** `GET /api/health` returns `{ ok, version, dbOk }`, with 503 when the database is
unavailable. Run `bun run cli stats` for row counts and file size, and `bun run cli player list` for each
player's last sync and error.

**One instance per database.** The scheduler runs inside the app process. Two containers on the same
volume would sync twice and contend for SQLite locks. Keep the replica count at 1. Coolify's rolling update
briefly runs the old and new container together. That is harmless, because battles are de-duplicated.

**Admin tokens.** `bun run cli admin-token list` shows each token's id, name, prefix, creation time, last use,
and revocation. Revoke one with `bun run cli admin-token revoke <id>`.

**Manual sync.** `bun run cli sync <tag>` and `bun run cli sync --all` sync without the cooldown. Write the
tag without `#`, because the shell treats `#` as the start of a comment.

## Limitations

- **No account balances.** The app computes upgrade costs, but Supercell's API has no gold, gems, or wild
  card balances, and no shop, Pass Royale, or chest contents. For spending advice, put your resources in the
  player notes.
- **History starts when you link a tag.** Earlier battles can't be recovered. If the app is down long
  enough for more than about 25 battles to be played, the older ones are lost.
- **One owner per tag.** A player tag can be linked to only one account.
- **IP-bound keys.** Moving servers means updating the key's allowlist.
- **No self-service password reset.** An admin runs `bun run cli user set-password <name> <password>`.
- **Upcoming chests** use an endpoint that is sometimes unavailable. A failed chest fetch does not fail the
  sync.
- **Unofficial.** This project is not affiliated with or endorsed by Supercell.
