---
name: clash-royale-companion
description: Coach a Clash Royale player using their self-hosted Clash Royale Companion app. Loads the player's synced profile, card levels, battle history and stats over the app's HTTP API, gives deck and upgrade advice grounded in that data, and saves decks and notes back to the app. Use when the user asks about their Clash Royale account, decks, card upgrades, win rate, recent battles or matchups, or mentions the companion app.
---

# Clash Royale Companion

The user runs a self-hosted app that syncs their Clash Royale account on a schedule (daily by default) and exposes it through a
JSON API. Use that API as your source of truth. Never guess card levels, trophies or results.

## Setup

You need two values:

- `CR_COMPANION_URL`: the app's base URL, for example `https://cr.example.com` (no trailing slash).
- `CR_COMPANION_API_KEY`: a personal API key starting with `crk_`. The user creates it on the app's
  **Settings** page, under API keys.

Read them from the environment first. If they are missing, load the `.env` file in this skill's folder (the
user creates it from `.env.example` next to this file), then fall back to a `.env` in the current project.
Load it without printing it, in the same command that uses the values:

```sh
set -a; . "<this skill's folder>/.env"; set +a
```

If the values are still missing, ask the user to copy `.env.example` to `.env` in this skill's folder and fill
it in. Do not ask them to paste the key into the chat.

Treat the key as a secret:

- Reference it as `$CR_COMPANION_API_KEY` in commands. Never print it, echo it, or write it into files the
  user did not ask for.
- Send it on every request as `Authorization: Bearer $CR_COMPANION_API_KEY`.
- A key grants read and write access to the user's players, decks and notes. It cannot create or revoke keys.

```sh
curl -sS -H "Authorization: Bearer $CR_COMPANION_API_KEY" "$CR_COMPANION_URL/api/me"
```

## Workflow

1. **Find the player.** Call `GET /api/me`. It returns the user and their tracked `players`. If there are
   several, ask which account they mean, or use the one they named. If there are none, tell them to link
   their tag on the Settings page, or call `POST /api/players` with `{ "tag": "#XXXX" }` if they give you one.
2. **Load the context before any advice.** Call `GET /api/players/{tag}/context.md`. This Markdown document
   holds the profile, current deck, 7-day and 30-day stats, deck performance, recent battles, collection
   summary, upgrade-ready cards, saved decks and the user's notes. Read all of it first.
3. **Refresh if stale.** The context header shows `Synced at`. If it is older than the last time the user played, or the user
   says they just played, call `POST /api/players/{tag}/sync`, then reload the context.
   - A `429` with code `cooldown` means a sync ran recently. `details.retryAfterSeconds` says when the next
     one is allowed. Use the data you have and say how old it is. Do not retry in a loop.
   - A `502` with code `upstream_error` means the Clash Royale API is unreachable or in maintenance. Use the
     stored data and say so.
4. **Drill down only when needed.**
   - `GET /api/players/{tag}/battles?since=...&mode=...&result=...` for specific matches.
   - `GET /api/players/{tag}/stats?days=N` for win rates by mode and by deck, plus trophy history. Add
     `&mode=Ranked` (or any `modeLabel`, such as `Trophy Road` or `Royale Shuffle`) to get deck win rates
     for one mode only.
   - `GET /api/players/{tag}/cards` for every card's level and upgrade cost. Each card has `countNeeded` and
     `goldNeeded` for its next level, `copiesToMax` and `goldToMax` for reaching `maxLevel`, and
     `upgradeReady`. Use these for upgrade priorities and gold budgets. Sum `goldNeeded` over the cards
     you recommend and compare it with the budget the user gives you.
5. **Save decks the user likes.** Before proposing a deck, check the card names against `GET /api/cards`.
   When the user wants to keep it, call `POST /api/decks` with
   `{ "name": "...", "cards": [8 exact names], "notes": "why it works, how to play it" }`. Requests made
   with an API key are saved with `source: "ai"` automatically. Then call
   `GET /api/decks/{id}/check?tag={tag}` and tell the user about unowned or under-levelled cards.
6. **Write notes only when asked.** Use `PUT /api/players/{tag}/notes` only when the user asks you to record
   something, such as a budget, a goal, or a playstyle preference. The call replaces the whole note, so
   `GET` it first and send back the merged content.

## Player tags in URLs

Tags look like `#9QJUGC2R`. In URL paths, drop the `#` (`/api/players/9QJUGC2R/stats`) or encode it as
`%23`. A raw `#` starts a URL fragment, so the server never sees the rest of the path. Tags are
case-insensitive, and the letter O is read as zero. The same applies to the `?tag=` query parameter. In JSON
bodies, `#9QJUGC2R` and `9QJUGC2R` both work.

## Card names

Deck endpoints accept only exact catalog names. Matching ignores case but nothing else. Fetch
`GET /api/cards?kind=card` once per session and map the user's nicknames to catalog names.

| The user says | Catalog name |
|---|---|
| Pekka, PEKKA | `P.E.K.K.A` |
| Mini Pekka, MP | `Mini P.E.K.K.A` |
| Xbow, X bow | `X-Bow` |
| Hog | `Hog Rider` |
| Log | `The Log` |
| E-Wiz, Ewiz | `Electro Wizard` |
| Skarmy | `Skeleton Army` |
| Pump, Collector | `Elixir Collector` |
| Barb Barrel | `Barbarian Barrel` |
| Snowball | `Giant Snowball` |
| MK | `Mega Knight` |
| RG | `Royal Giant` |
| Fire Spirits | `Fire Spirit` |

More rules:

- **Evolutions and Heroes are not separate cards.** "Evo Knight" and "Hero Knight" are both `Knight`. A deck
  lists the base card, and the game decides which slots use the Evo or Hero form.
- **Tower troops can't go in a deck.** Tower Princess, Cannoneer, Dagger Duchess and the others have
  `kind: "support"`.
- **A deck has exactly 8 distinct cards.** A bad deck returns `400 invalid_deck` with
  `details: { unknown, duplicates, count }`. Fix the names listed in `unknown` and retry once.

## Endpoint reference

All paths are relative to `$CR_COMPANION_URL`. Every endpoint needs the Bearer key. Timestamps are ISO 8601
UTC. `{tag}` is a player tag without `#`.

| Method | Path | Body or query | Response |
|---|---|---|---|
| GET | `/api/me` | | `{ user: { id, username, createdAt }, authMethod, players: Player[] }` |
| GET | `/api/players` | | `{ players: Player[] }` |
| POST | `/api/players` | `{ tag }` | `201 { player, battlesAdded, syncError? }`. Checks the tag upstream and runs the first sync |
| DELETE | `/api/players/{tag}` | | `204`. Deletes the player with all stored battles, snapshots and notes. Confirm with the user first |
| GET | `/api/players/{tag}` | | `{ player, snapshot: { fetchedAt, lastSeenAt, profile, currentDeck: DeckCard[], currentDeckSupportCards } \| null }`. `lastSeenAt` is the latest sync that confirmed this data; `fetchedAt` is when it last changed. `profile` includes `kingTowerLevel`, `collectionLevel` and `currentWinLoseStreak` (absent on snapshots from before May 2026). Ignore `profile.expLevel`: it has been frozen since XP was removed |
| GET | `/api/players/{tag}/battles` | `since`, `until` (ISO), `mode`, `result` (`win\|loss\|draw`), `limit` (1–500, default 50), `offset` | `{ battles: Battle[], total }`, newest first |
| GET | `/api/players/{tag}/battles/{id}` | | `{ battle: Battle & { raw } }`. `raw` is the upstream battle JSON, whose card levels are rarity-relative. Never use `raw` for level reasoning; use `teamDeck` and `opponentDeck` |
| GET | `/api/players/{tag}/stats` | `days` (1–365, default 30), `mode` (optional, same matching as the battles filter) | `{ stats: { sinceDays, total, wins, losses, draws, winRate, netTrophies, byMode[], byDeck[] }, trophyHistory[] }` |
| GET | `/api/players/{tag}/cards` | | `{ summary, cards: CollectionEntry[], fetchedAt, lastSeenAt }` |
| GET | `/api/players/{tag}/notes` | | `{ notes: { content, updatedAt } \| null }` |
| PUT | `/api/players/{tag}/notes` | `{ content }` (Markdown, max 20,000 chars) | `{ notes: { content, updatedAt } }`. Replaces the whole note |
| POST | `/api/players/{tag}/sync` | | `{ ok: true, battlesAdded }`, or `429 cooldown`, or `502 upstream_error` |
| GET | `/api/players/{tag}/context.md` | | `text/markdown`, the full coaching context |
| GET | `/api/players/{tag}/context` | | `{ markdown }`, the same document as JSON |
| GET | `/api/decks` | | `{ decks: Deck[] }` |
| POST | `/api/decks` | `{ name, cards: string[8], notes? }` | `201 { deck }` |
| GET | `/api/decks/{id}` | | `{ deck }` |
| PATCH | `/api/decks/{id}` | any of `{ name, cards, notes }` | `{ deck }` |
| DELETE | `/api/decks/{id}` | | `204` |
| GET | `/api/decks/{id}/check` | `tag` | `{ fetchedAt, lastSeenAt, cards: [{ name, level, maxLevel, owned, evolutionLevel }], avgElixir, missing: string[] }`. If the player has no snapshot yet, `fetchedAt` and `lastSeenAt` are null, `owned`, `level` and `evolutionLevel` are null, `missing` is empty and `note` is `"no snapshot yet"`: ownership is unknown, so do not call the cards missing |
| GET | `/api/cards` | `kind` (`card\|support`, optional) | `{ cards: [{ id, name, kind, rarity, elixirCost, maxLevel, maxEvolutionLevel, iconUrl, iconUrlEvo, iconUrlHero, updatedAt }] }` |

Shapes:

- **Player**: `{ tag, userId, name, addedAt, lastSyncedAt, lastSyncError }`.
- **DeckCard**: `{ id, name, level, evolutionLevel, ... }`. `level` is the in-game display level.
  `evolutionLevel` is a bitmask: 0 = none, 1 = Evo, 2 = Hero, 3 = both. It is not a count.
- **Battle**: `{ id, battleTime, type, gameModeName, eventTag, modeLabel, arenaName, opponentTag, opponentName,
  result, teamCrowns, opponentCrowns, teamDeck: DeckCard[], opponentDeck: DeckCard[], deckKey, trophyChange,
  isTwoVsTwo }`. Name modes by `modeLabel` ("Ranked", "Trophy Road", "Clan War", "2v2", "Royale Shuffle",
  …). `type` (`PvP`, `pathOfLegend`, `trail`, `unknown`, …) and `gameModeName` (`Ladder`,
  `RR_Heist_Friendly`, …) are raw upstream ids. The `mode` filter accepts a `modeLabel` or either raw value.
  In 2v2, `teamDeck` has 16 cards with the player's 8 first.
- **byMode entry**: `{ type, mode, modeLabel, games, wins, losses, draws, winRate }`, one per `modeLabel`.
- **byDeck entry**: `{ deckKey, cards, games, wins, losses, draws, winRate, avgElixir, lastPlayed }`. `winRate` is 0 to 1; `lastPlayed` is the newest battle time with the deck.
- **CollectionEntry**: `{ name, rarity, elixirCost, owned, level, maxLevel, count, countNeeded, goldNeeded,
  copiesToMax, goldToMax, upgradeReady, evolutionLevel, maxEvolutionLevel, iconUrlHero, kind }`. Both
  evolution fields are the Evo/Hero bitmask: `maxEvolutionLevel` is which forms the card has, `evolutionLevel`
  which the player owns. `level` is null for
  unowned cards. `count` is the copies held. `countNeeded` and `goldNeeded` are the cost of the next level,
  and both are null when the card is unowned or maxed. `copiesToMax` is the copies still to collect beyond
  `count`. `goldToMax` is the gold from the current level to max, and it is 0 when the card is maxed.
- **Deck**: `{ id, name, cards, notes, source: "manual" | "ai", createdAt, updatedAt, avgElixir,
  cardDetails: [{ name, elixirCost, rarity, iconUrl }] }`.

### Errors

Errors return `{ "error": { "code", "message", "details"? } }`.

| Status | Code | Meaning and what to do |
|---|---|---|
| 401 | `unauthorized` | The key is missing, revoked or wrong. Ask the user to check `CR_COMPANION_API_KEY`. |
| 404 | `not_found` | Unknown or not the user's player, deck or battle. Other users' players also return 404. |
| 400 | `validation_error` | Bad body or query. `details.issues` lists the fields. |
| 400 | `invalid_deck` | Wrong card count, unknown names, or duplicates. See `details`. |
| 400 | `invalid_tag` | The tag contains characters outside `0289PYLQGRJCUV`. |
| 409 | `conflict` | The tag is already linked to this or another account. |
| 429 | `cooldown` | A sync ran recently. Wait `details.retryAfterSeconds`. |
| 502 | `upstream_error` | The Clash Royale API failed. Work with the stored data. |

## Advice guardrails

- **Levels.** Every level the API returns is the in-game display level, not the raw rarity-relative number
  from Supercell. The maximum is 16 for every rarity. The one exception is `raw` on a single battle, which
  is Supercell's JSON unchanged; ignore its levels.
- **Upgrade costs.** Since the November 2025 economy update, every level from 1 to 16 costs copies plus
  gold, and the gold for a given level is the same for every rarity. Elite Wild Cards no longer exist, so
  never mention them. Take costs from the collection endpoint rather than from memory.
- **Evolutions and Heroes.** Both are forms of a card, not separate cards. Decode `evolutionLevel` as a
  bitmask (1 = Evo, 2 = Hero, 3 = both); a value of 2 is a Hero, not a second evolution.
- **King level and chests are gone.** XP was removed on 2026-05-26: talk about King Tower level and
  Collection Level from the context, never `expLevel`. The chest cycle was removed in March 2025, so don't
  plan around chests. Merge Tactics matches are not in the battle log.
- **No account balances.** The API shows what upgrades cost but not how much gold, gems or wild cards the
  player has. It also has no shop offers, Pass Royale or Lucky Chest contents. For budget advice, read the player
  notes or ask the user. Offer to save the answer to the notes.
- **Limited history.** Battles exist only from when the player was linked to the app. Supercell's battle
  log keeps about 25 matches, so gaps are possible if the app was down. Say so when a sample is small, for
  example under 20 games for a deck.
- **Stale data.** Always state how old the data is when it matters, such as after a sync failure or when
  `lastSyncError` is set.
- **Scope.** Only the user's own linked players are visible. You cannot look up arbitrary opponents'
  profiles, but opponent decks inside stored battles are available.
- **Ground claims.** When you quote a win rate, include the games count behind it and the time window.

## Examples

```sh
H="Authorization: Bearer $CR_COMPANION_API_KEY"

# Which players does this user track?
curl -sS -H "$H" "$CR_COMPANION_URL/api/me"

# Full context for advice
curl -sS -H "$H" "$CR_COMPANION_URL/api/players/9QJUGC2R/context.md"

# Refresh, which may return 429 cooldown
curl -sS -X POST -H "$H" "$CR_COMPANION_URL/api/players/9QJUGC2R/sync"

# Ranked losses in the last week
curl -sS -H "$H" "$CR_COMPANION_URL/api/players/9QJUGC2R/battles?mode=Ranked&result=loss&since=$(date -u -d '7 days ago' +%FT%TZ)"

# Save a deck, then check it against the player's levels
curl -sS -X POST -H "$H" -H "Content-Type: application/json" "$CR_COMPANION_URL/api/decks" \
  -d '{"name":"Hog 2.6","cards":["Hog Rider","Musketeer","Ice Golem","Ice Spirit","Skeletons","Cannon","Fireball","The Log"],"notes":"Fast cycle. Out-cycle their counters to Hog."}'
curl -sS -H "$H" "$CR_COMPANION_URL/api/decks/1/check?tag=9QJUGC2R"
```
