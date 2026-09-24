import { type Context, Hono } from "hono";
import { z } from "zod";
import { currentUser, requireUser } from "../../auth/middleware";
import { displayLevel } from "../../cr/levels";
import { normalizeTag } from "../../cr/tag";
import type { Player, PlayerCard } from "../../cr/types";
import { buildCollection } from "../../domain/collection";
import { playerContextMarkdown } from "../../domain/playerContext";
import { AppError, errorBody, notFound } from "../../errors";
import { parseJson, parseQuery, parseWith } from "../../http/validate";
import { countBattles, getBattle, getBattleStats, listBattles } from "../../repos/battles";
import { type CardRecord, cardsById, listCards } from "../../repos/cards";
import { getNotes, setNotes } from "../../repos/notes";
import {
  assertPlayerOwnedBy,
  getLatestSnapshot,
  getTrophyHistory,
  listPlayersForUser,
  type PlayerRecord,
  removePlayer,
} from "../../repos/players";
import { manualSync, trackPlayer } from "../../sync";
import type { AppEnv } from "../../types";

const ownedPlayer = (c: Context<AppEnv>): PlayerRecord =>
  assertPlayerOwnedBy(normalizeTag(c.req.param("tag") ?? ""), currentUser(c).id);

function toDeckCardView(card: PlayerCard, catalog: Map<number, CardRecord>) {
  const known = catalog.get(card.id);
  const rarity = card.rarity ?? known?.rarity ?? null;
  return {
    id: card.id,
    name: card.name,
    level: displayLevel(card.level, rarity),
    evolutionLevel: card.evolutionLevel ?? 0,
    rarity,
    elixirCost: card.elixirCost ?? known?.elixirCost ?? null,
    iconUrl: known?.iconUrl ?? card.iconUrls?.medium ?? null,
    iconUrlEvo: known?.iconUrlEvo ?? card.iconUrls?.evolutionMedium ?? null,
  };
}

/** The favourite card carries raw API levels like every other profile card; convert or drop them. */
function favouriteCardView(card: NonNullable<Player["currentFavouriteCard"]>, catalog: Map<number, CardRecord>) {
  const { maxLevel, level, ...rest } = card as typeof card & { level?: number };
  const rarity = card.rarity ?? catalog.get(card.id)?.rarity;
  if (!rarity) return rest;
  return {
    ...rest,
    ...(level === undefined ? {} : { level: displayLevel(level, rarity) }),
    maxLevel: displayLevel(maxLevel, rarity),
  };
}

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date or timestamp")
  .transform((s) => new Date(s).toISOString());

const battlesQuery = z.object({
  since: isoDate.optional(),
  until: isoDate.optional(),
  mode: z.string().min(1).max(64).optional(),
  result: z.enum(["win", "loss", "draw"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const statsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  mode: z.string().min(1).max(64).optional(),
});

export const playerRoutes = new Hono<AppEnv>()
  .use("/players/*", requireUser)
  .get("/players", (c) => c.json({ players: listPlayersForUser(currentUser(c).id) }))
  .post("/players", async (c) => {
    const { tag } = await parseJson(c, z.object({ tag: z.string().min(1).max(20) }));
    const result = await trackPlayer(currentUser(c).id, tag);
    return c.json(result, 201);
  })
  .delete("/players/:tag", (c) => {
    const tag = normalizeTag(c.req.param("tag"));
    if (!removePlayer(tag, currentUser(c).id)) throw notFound("Player");
    return c.body(null, 204);
  })
  .get("/players/:tag", (c) => {
    const player = ownedPlayer(c);
    const snap = getLatestSnapshot(player.tag);
    if (!snap) return c.json({ player, snapshot: null });
    const catalog = cardsById();
    // Level-bearing arrays are dropped from the raw profile: they carry API-relative levels and
    // are either huge (cards) or re-exposed below with display levels (current deck).
    const { cards, supportCards, achievements, badges, currentDeck, currentDeckSupportCards, currentFavouriteCard, ...rest } =
      snap.player;
    const profile = currentFavouriteCard
      ? { ...rest, currentFavouriteCard: favouriteCardView(currentFavouriteCard, catalog) }
      : rest;
    return c.json({
      player,
      snapshot: {
        fetchedAt: snap.fetchedAt,
        lastSeenAt: snap.lastSeenAt,
        profile,
        currentDeck: currentDeck.map((card) => toDeckCardView(card, catalog)),
        currentDeckSupportCards: (currentDeckSupportCards ?? []).map((card) => toDeckCardView(card, catalog)),
        chests: snap.chests?.items ?? null,
      },
    });
  })
  .get("/players/:tag/battles", (c) => {
    const player = ownedPlayer(c);
    const q = parseQuery(c, battlesQuery);
    const filter = { since: q.since, until: q.until, mode: q.mode, result: q.result };
    return c.json({
      battles: listBattles(player.tag, { ...filter, limit: q.limit, offset: q.offset }),
      total: countBattles(player.tag, filter),
    });
  })
  .get("/players/:tag/battles/:id", (c) => {
    const player = ownedPlayer(c);
    const id = parseWith(z.coerce.number().int().positive(), c.req.param("id"));
    const battle = getBattle(player.tag, id);
    if (!battle) throw notFound("Battle");
    return c.json({ battle });
  })
  .get("/players/:tag/stats", (c) => {
    const player = ownedPlayer(c);
    const { days, mode } = parseQuery(c, statsQuery);
    return c.json({
      stats: getBattleStats(player.tag, { sinceDays: days, mode }),
      trophyHistory: getTrophyHistory(player.tag, { sinceDays: days }),
    });
  })
  .get("/players/:tag/cards", (c) => {
    const player = ownedPlayer(c);
    const snap = getLatestSnapshot(player.tag);
    const { entries, summary } = buildCollection(snap?.player ?? null, listCards());
    return c.json({ summary, cards: entries, fetchedAt: snap?.fetchedAt ?? null, lastSeenAt: snap?.lastSeenAt ?? null });
  })
  .get("/players/:tag/notes", (c) => c.json({ notes: getNotes(ownedPlayer(c).tag) }))
  .put("/players/:tag/notes", async (c) => {
    const player = ownedPlayer(c);
    const { content } = await parseJson(c, z.object({ content: z.string().max(20_000) }));
    return c.json({ notes: setNotes(player.tag, content) });
  })
  .post("/players/:tag/sync", async (c) => {
    const player = ownedPlayer(c);
    const r = await manualSync(player.tag);
    if (r.ok) return c.json({ ok: true, battlesAdded: r.battlesAdded });
    if ("retryAfterSeconds" in r) {
      c.header("Retry-After", String(r.retryAfterSeconds));
      return c.json(
        errorBody("cooldown", `Synced recently; try again in ${r.retryAfterSeconds}s`, {
          retryAfterSeconds: r.retryAfterSeconds,
        }),
        429,
      );
    }
    throw new AppError("upstream_error", r.error, 502);
  })
  .get("/players/:tag/context.md", (c) => {
    const markdown = playerContextMarkdown(ownedPlayer(c));
    return c.body(markdown, 200, { "Content-Type": "text/markdown; charset=utf-8" });
  })
  .get("/players/:tag/context", (c) => c.json({ markdown: playerContextMarkdown(ownedPlayer(c)) }));
