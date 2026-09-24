# Architecture

Self-hosted Clash Royale companion. Syncs player data from the official API (https://api.clashroyale.com/v1)
into SQLite on a schedule, serves server-rendered pages, and exposes a JSON API that AI assistants call
with per-user API keys. Multi-user, invite-only. Runs as one Bun process (Docker on Coolify).

Stack: Bun 1.4, TypeScript (strict, `noUncheckedIndexedAccess`), Hono + `hono/jsx` (SSR, no client
framework), `bun:sqlite` (WAL), Zod 4, croner. No ORM.

## Run locally

```sh
cp .env.example .env        # set CR_API_TOKEN (the CLI needs it only for sync)
bun install
bun run cli invite create   # prints an invite code for /register (or: bun run cli user create <name> <pw>)
bun run dev                 # http://localhost:3000, restarts on change
bun test                    # all tests, in-memory DB
bun run typecheck
```

The CR API key is bound to an IP allowlist. From a dev machine, create a key for your own public IP, or set
`CR_API_BASE=https://proxy.royaleapi.dev/v1` and allowlist the proxy's IP (45.79.218.79).

## Layout

```
src/
  server.ts            Entry: requires env, migrate(), card sync if empty, scheduler, Bun.serve, SIGTERM.
  app.tsx              createApp(): static, csrf, authenticate, flash, registerRoutes, 404 + error handlers.
  config.ts            `config` (zod-parsed env), requireEnv("CR_API_TOKEN").
  errors.ts            AppError(code, message, status, details?) + errorBody().
  types.ts             User, AuthMethod, Flash, AppEnv (use `new Hono<AppEnv>()` everywhere).
  util.ts              nowIso, daysAgoIso, sleep, ratio.
  db/index.ts          getDb(), setDatabase(), openDatabase(), migrate(), closeDatabase().
  db/migrations/       NNNN_name.sql, applied in order at startup, tracked in schema_migrations.
  cr/                  Clash Royale API: client.ts (CrClient, CrApi, CrApiError, getCrClient),
                       types.ts (response types, parseBattleTime), tag.ts, levels.ts.
  auth/                passwords, users, register, sessions, apiKeys, adminTokens, invites, middleware, crypto.
  repos/               Typed queries: players, battles, cards, decks, notes, syncRuns.
  sync/                syncPlayer, syncCards, syncAll, manualSync, trackPlayer, scheduler (index.ts re-exports).
  http/                validate.ts (zod helpers), flash.ts, csrf.ts.
  routes/index.ts      registerRoutes(app): THE place routers are mounted.
  routes/api/*.ts      JSON routers, mounted under /api.
  routes/pages/*.tsx   HTML routers, mounted under /.
  views/               Layout.tsx, render.tsx (renderPage), components.tsx, format.ts.
  cli/index.ts         bun run cli: migrate, invite, user, admin-token create|list|revoke, player, sync, stats.
public/                Served at /static/* (app.css dark theme; app.js: copy buttons, card image fallback, sync countdown).
test/                  *.test.ts(x), helpers.ts, fixtures/{player,battlelog,chests,cards}.json.
```

## Conventions

- Named exports only (no default exports). Small modules. Imports without file extensions.
- Repos return camelCase domain objects (`PlayerRecord`, `BattleRecord`, ...), never raw rows.
- All timestamps are ISO 8601 UTC strings (`new Date().toISOString()`), in DB and JSON.
- Player tags are always stored and passed normalized (`#` + uppercase). Normalize user input with
  `normalizeTag()` at the route boundary. In our own URLs use `tagSlug(tag)` (no `#`); `normalizeTag`
  accepts slugs, so `normalizeTag(c.req.param("tag"))` just works.
- Errors: throw `AppError`. The global handler renders `{ error: { code, message, details? } }` with its
  status under `/api/*`, and an HTML error page elsewhere. Unknown errors become 500 `internal_error`
  (logged, message hidden). Helper: `notFound("Deck")`.
- Validation: `parseJson(c, schema)`, `parseForm(c, schema)`, `parseQuery(c, schema)`, `parseWith(schema, x)`
  from `src/http/validate.ts` throw `AppError("validation_error")` with `details.issues`.
- Comments only for the non-obvious why, an external gotcha, or a constraint an edit could break.

## Adding a route

1. Create a router file that declares its own auth:

```ts
// src/routes/api/decks.ts
import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireUser } from "../../auth/middleware";
import { parseJson } from "../../http/validate";
import { createDeck, listDecks } from "../../repos/decks";
import type { AppEnv } from "../../types";

export const deckRoutes = new Hono<AppEnv>()
  .use("/decks/*", requireUser) // "/decks/*" also matches "/decks"
  .get("/decks", (c) => c.json({ decks: listDecks(currentUser(c).id) }))
  .post("/decks", async (c) => {
    const body = await parseJson(c, z.object({ name: z.string().min(1), cards: z.array(z.string()), notes: z.string().optional() }));
    return c.json({ deck: createDeck(currentUser(c).id, { ...body, source: c.var.authMethod === "apikey" ? "ai" : "manual" }) }, 201);
  });
```

```tsx
// src/routes/pages/decks.tsx
import { Hono } from "hono";
import { currentUser, requireUser } from "../../auth/middleware";
import { renderPage } from "../../views/render";
import type { AppEnv } from "../../types";

export const deckPages = new Hono<AppEnv>()
  .use("/decks/*", requireUser)
  .get("/decks", (c) => renderPage(c, { title: "Decks", active: "decks" }, <h1>Decks</h1>));
```

2. Mount it in `src/routes/index.ts` with one import and one line: `app.route("/api", deckRoutes)` or
   `app.route("/", deckPages)`. Several agents edit this file, so keep it to one line per router.

**Always scope middleware to your own paths.** An unscoped `.use(requireUser)` in a sub-app mounted at
`/api` also runs for every *other* router mounted at `/api` after it. For example, it would 401 the admin
endpoints, which authenticate with an admin token rather than a user. Use `.use("/decks/*", guard)` or
per-route `.get("/x", guard, handler)`. The same applies to page routers mounted at `/`, where a leak would
force login on `/login`.

## Auth

Global `authenticate` sets, for every request:

- `c.var.user: User | null` (`{ id, username, createdAt }`)
- `c.var.authMethod: "session" | "apikey" | null`

Resolution: any `Authorization: Bearer ...` request authenticates only by API key (`crk_...`) and never
falls back to the cookie, even when the key is invalid. An admin token (`cra_...`) leaves `user` null, so it
gets 401 on user routes; only `requireAdmin` accepts it. Requests without a Bearer header (including Basic from
an auth proxy) use the `cr_session` cookie.

Route guards in `src/auth/middleware.ts`:

| Guard | Allows | Failure |
|---|---|---|
| `requireUser` | session or API key | 401 JSON under /api, else 302 `/login?next=...` |
| `requireSession` | browser session only (API key management, account settings) | 403/401 JSON, or login redirect |
| `requireAdmin` | `Authorization: Bearer cra_...`, an unrevoked admin token from the DB | 401 JSON |

`currentUser(c)` returns the non-null `User` inside guarded handlers.

Building blocks for login/register/logout pages (not yet implemented as routes):

- `verifyCredentials(username, password) -> User | null` (timing-equalized for unknown users)
- `registerWithInvite({ username, password, inviteCode }) -> User`; throws `validation_error`,
  `invalid_invite`, or `conflict`. Invite use and user insert are one transaction.
- `startSession(c, userId)` sets the cookie; `endSession(c)` deletes the session and clears it.
  The Layout's logout button POSTs to `/logout`.
- `setFlash(c, "success" | "error" | "info", msg)` before a redirect; the next `renderPage` shows it.
- Username rules: 3–32 of `[a-z0-9_]`, stored lowercased; password 8–256 chars.

CSRF: `src/http/csrf.ts` rejects cross-site form POSTs (Origin / Sec-Fetch-Site check). It is skipped only for
`Authorization: Bearer` requests, which never use the cookie. Keep those two rules in sync (`isBearer`). Forms need no token. `APP_URL`'s origin is accepted so it works
behind a TLS-terminating proxy. Session cookies are `Secure` only when `APP_URL` starts with `https://`.

## Repository API

All repos use `getDb()` and are synchronous. `tag` arguments are normalized tags.

**auth/users**: `createUser(username, password): Promise<User>`, `insertUser(username, hash): User`,
`getUserByUsername(name)`, `getUserById(id)`, `listUsers()`, `verifyCredentials(u, p)`,
`setPassword(userId, pw)`, `normalizeUsername(s)`, `validatePassword(s)`.

**auth/sessions**: `createSession(userId, now?) -> rawToken`, `getUserBySessionToken(token, now?)`,
`deleteSession(token)`, `deleteSessionsForUser(userId)`, `purgeExpiredSessions(now?)`,
`startSession(c, userId)`, `endSession(c)`, `setSessionCookie`, `clearSessionCookie`, `getSessionToken(c)`.
Constants `SESSION_COOKIE = "cr_session"`, `SESSION_TTL_SECONDS` (30 days, fixed, not sliding).

**auth/apiKeys**: `createApiKey(userId, name) -> { raw, record }` (show `raw` once),
`getUserByApiKey(raw, now?)` (stamps last_used_at), `listApiKeys(userId, { includeRevoked? })`,
`revokeApiKey(userId, keyId) -> boolean`. `ApiKeyRecord.keyPrefix` is the first 8 chars (`crk_XXXX`).

**auth/adminTokens**: `createAdminToken(name) -> { raw, record }` (show `raw` once), `verifyAdminToken(raw, now?)
-> AdminTokenRecord | null` (stamps last_used_at), `listAdminTokens({ includeRevoked? })`, `revokeAdminToken(id) -> boolean`.
Created only from the CLI (`admin-token create|list|revoke`). Not tied to a user.

**auth/invites**: `createInvite({ maxUses?, expiresInDays? }) -> InviteRecord`, `consumeInvite(code, now?) -> boolean`
(atomic), `getInviteByCode(code)`, `isInviteUsable(invite)`, `listInvites()`, `revokeInvite(id)`.
Codes are 12 chars, case-insensitive.

**repos/players**
- `addPlayer(userId, tag, name?) -> PlayerRecord` throws `conflict` if any user tracks the tag
- `assertTagAvailable(tag, userId)`, `removePlayer(tag, userId) -> boolean` (cascades everything)
- `listPlayersForUser(userId)`, `listAllPlayers()`, `getPlayer(tag)`
- `assertPlayerOwnedBy(tag, userId) -> PlayerRecord` throws 404 (not 403) for other users' tags.
  Call this before any per-player read or write in a route.
- `setSyncResult(tag, { ok: true, name? } | { ok: false, error })`
- `insertSnapshot(tag, player, chests, fetchedAt?)`, `getLatestSnapshot(tag) -> { player: Player, chests, fetchedAt } | null`
- `getTrophyHistory(tag, { sinceDays? }) -> { fetchedAt, trophies, bestTrophies, polTrophies, polLeague }[]`

**repos/battles**
- `insertBattles(tag, entries: BattleLogEntry[]) -> added` (INSERT OR IGNORE on player_tag+battle_time+opponent_tag)
- `listBattles(tag, { since?, until?, mode?, result?, limit? (50, max 500), offset? }) -> BattleRecord[]`, newest first.
  `mode` matches either `type` ("pathOfLegend") or `gameModeName` ("Ladder").
- `countBattles(tag, filter)`, `getBattle(tag, id) -> BattleRecord & { raw }`
- `getBattleStats(tag, { sinceDays?, mode? }) -> { sinceDays, total, wins, losses, draws, winRate, netTrophies, byMode[], byDeck[] }`.
  Each byMode entry has `{ type, mode, games, wins, losses, draws, winRate }`. Each byDeck entry has
  `{ deckKey, cards, games, wins, losses, draws, winRate, avgElixir | null }`. winRate is 0..1.
- `BattleRecord.teamDeck` / `opponentDeck` are `DeckCard[] = { id, name, level, evolutionLevel }`.
  `level` is already the in-game display level.
- 2v2: `teamDeck` holds 16 cards with the tracked player's 8 first. `isTwoVsTwo` comes from the stored
  `team_size` (not the deck length), and `deckKey` uses only the player's own 8 cards. `opponentName` joins
  both names with " & ".
- Boat battles report 0-0 crowns; the result comes from the entry's `boatBattleWon`.
- `insertBattles` logs and skips a malformed entry instead of failing the whole log.

**repos/cards**: `upsertCards(items, kind)`, `listCards({ kind? })`, `countCards()`,
`getCardByName(name)` (case-insensitive), `getCardById(id)`, `cardsMap() -> Map<name, CardRecord>`,
`cardsById()`. `kind: "card" | "support"`, where support means tower troops. `elixirCost` is null for Mirror.

**repos/decks**: `validateDeckCards(names) -> canonicalNames` throws `invalid_deck` with
`details { unknown, duplicates, count }`. Also `createDeck(userId, { name, cards, notes?, source? })`,
`listDecks(userId)`, `getDeck(userId, id)`, `updateDeck(userId, id, patch)` (404 if not the owner's), and
`deleteDeck(userId, id) -> boolean`.

**repos/notes**: `getNotes(tag) -> { content, updatedAt } | null`, `setNotes(tag, content)`. There is one
markdown note per player.

**repos/syncRuns**: `startSyncRun(tag) -> id`, `finishSyncRun(id, { status, battlesAdded?, error? })`,
`listRecentSyncRuns({ tag?, limit? })`, `getLastSyncRun(tag)`. Status is `running | ok | error`.

## Sync

`src/sync/index.ts` exports:

- `trackPlayer(userId, rawTag, client?)` is the "add player" flow. It normalizes the tag, checks it exists
  upstream, adds it, and runs the first sync. It throws `invalid_tag`, `not_found`, `conflict`, or `upstream_error`.
- `manualSync(tag, client?) -> { ok: true, battlesAdded } | { ok: false, retryAfterSeconds } | { ok: false, error }`.
  The cooldown of `SYNC_COOLDOWN_SECONDS` counts from the last sync attempt of any kind. Check ownership first.
- `syncPlayer(tag, client) -> { battlesAdded, error?, errorStatus?, retryAfterSeconds? }` never throws for API
  errors. Chest failures are ignored.
- `syncAll(client, { delayMs? }) -> { players, failed, skipped, battlesAdded, rateLimited }` skips players removed
  mid-run, continues past unexpected errors, and stops the run at the first 429.
- `syncCards(client)`, and `startScheduler(client) -> { stop() }`. The scheduler runs `runSyncJob` on
  `SYNC_CRON` (reloads the card catalog first if it is empty, then `syncAll`) and `runDailyJob` at 04:17
  (snapshot pruning, card catalog, session purge; each step runs even if another fails).

`client` defaults to `getCrClient()`, built from config. In tests, pass `FakeCrClient` from `test/helpers.ts`.
The scheduler is in-process, so run exactly one app instance per database.

## Views

- `renderPage(c, { title, active?, status? }, <content/>)` wraps content in `Layout` with the user and flash.
- `components.tsx` provides `CardIcon({ card, size })`, `DeckGrid({ cards, size })`, `StatTile({ label, value, hint? })`,
  `Table({ columns: { label, align?, render(row) }[], rows, empty? })`, `ResultBadge({ result })`, and
  `EmptyState({ title })`. Components take `CardView`. Build one with `toCardView({ name, level?, evolutionLevel? }, cardsMap())`,
  which fills icon URLs from the catalog.
- `format.ts` provides `formatPercent(0.6) -> "60%"`, `formatDateTime`, `formatRelative`, and `formatSigned`.
- CSS classes in `public/app.css` include `.card`, `.stack`, `.row`, `.grid`, `.stats`, `.table`, `.btn`,
  `.btn-secondary`, `.btn-danger`, `.btn-link`, `.field`, `.form-narrow`, `.muted`, `.badge-{win,loss,draw}`,
  and `.flash-{info,success,error}`. Theme colors are CSS variables in `:root`.

## Clash Royale API gotchas

- **Card levels**: the API reports rarity-relative levels. A fresh legendary is level 1 in the API but 9 in
  game. Use `displayLevel(apiLevel, rarity)` from `src/cr/levels.ts` for anything shown to users or AIs. Battle
  decks are already converted at ingestion. `Player.cards` in snapshots are raw API levels.
- **Battle times**: `battleTime` looks like `20240101T120000.000Z`. Convert it with `parseBattleTime`, which is
  already done in the battles table.
- **Tags**: send tags URL-encoded (`%23...`). `CrClient` does this.
- **Battle log size**: it only holds about 25 recent battles, so the default daily sync loses battles for anyone playing more than that per day; set `SYNC_CRON` hourly for them.
- **Errors**: 403 usually means the IP is not on the key's allowlist. `CrApiError.status` is 0 for network failures.

## Database

The schema lives in `src/db/migrations/` (`0001_init.sql`, `0002_battles_team_size.sql`, `0003_admin_tokens.sql`). Add changes as the
next `NNNN_*.sql` file and never edit an applied one. Foreign keys are on, and deleting a player cascades to its snapshots, battles, notes, and sync runs.
Large payloads are stored as JSON text (`player_snapshots.data`, `battles.data`, `cards.data`). Query them with
`json_extract` rather than parsing in JS when you need one field, as `getTrophyHistory` does.

## Tests

```ts
import { beforeEach } from "bun:test";
import { makeTestDb, makeUser, seedCards, FakeCrClient, loadFixture, FIXTURE_TAG } from "./helpers";

beforeEach(() => {
  makeTestDb(); // fresh :memory: DB, migrated, installed via setDatabase()
  seedCards();  // card catalog from fixtures
});
```

- `makeUser(name?)` inserts a user without argon2, so it is fast but can't log in. Use `createUser` when a
  test needs a real password.
- For HTTP tests, call `createApp()` and then `app.request(path, init)`. Routes you add after `createApp()` still
  get the global middleware. See `test/app.test.tsx`.
- `config` is a mutable object, so tests set fields such as `config.SYNC_COOLDOWN_SECONDS` directly.
- Admin routes: `adminHeaders()` from `test/api/support.ts`, or `createAdminToken(name).raw` as the Bearer token.
- The fixture player is `#9QJUGC2R` "Sparky". Its battle log has 10 battles: 5 ladder, 3 Path of Legend
  (one draw), one 2v2, and one friendly. The catalog has 39 cards and 3 tower troops.
