import { type Context, Hono } from "hono";
import { z } from "zod";
import { currentUser, requireUser } from "../../auth/middleware";
import { normalizeTag } from "../../cr/tag";
import { buildCollection } from "../../domain/collection";
import { notFound } from "../../errors";
import { parseJson, parseQuery, parseWith } from "../../http/validate";
import { averageElixir } from "../../repos/battles";
import { type CardRecord, cardsMap, listCards } from "../../repos/cards";
import { createDeck, type DeckRecord, deleteDeck, getDeck, listDecks, updateDeck } from "../../repos/decks";
import { assertPlayerOwnedBy, getLatestSnapshot } from "../../repos/players";
import type { AppEnv } from "../../types";

// Card count and names are checked by validateDeckCards so its invalid_deck details reach the client.
const deckFields = {
  name: z.string().trim().min(1).max(80),
  cards: z.array(z.string().max(64)).max(16),
  notes: z.string().max(5000),
};

const createSchema = z.object({
  ...deckFields,
  notes: deckFields.notes.optional(),
  source: z.enum(["manual", "ai"]).optional(),
});

const patchSchema = z
  .object({
    name: deckFields.name.optional(),
    cards: deckFields.cards.optional(),
    notes: deckFields.notes.optional(),
  })
  .refine((p) => p.name !== undefined || p.cards !== undefined || p.notes !== undefined, "nothing to update");

function withDetails(deck: DeckRecord, catalog: Map<string, CardRecord>) {
  return {
    ...deck,
    avgElixir: averageElixir(deck.cards, catalog),
    cardDetails: deck.cards.map((name) => {
      const card = catalog.get(name);
      return {
        name,
        elixirCost: card?.elixirCost ?? null,
        rarity: card?.rarity ?? null,
        iconUrl: card?.iconUrl ?? null,
      };
    }),
  };
}

const deckId = (c: Context<AppEnv>): number => parseWith(z.coerce.number().int().positive(), c.req.param("id"));

function ownedDeck(c: Context<AppEnv>): DeckRecord {
  const deck = getDeck(currentUser(c).id, deckId(c));
  if (!deck) throw notFound("Deck");
  return deck;
}

export const deckRoutes = new Hono<AppEnv>()
  .use("/decks/*", requireUser)
  .get("/decks", (c) => {
    const catalog = cardsMap();
    return c.json({ decks: listDecks(currentUser(c).id).map((d) => withDetails(d, catalog)) });
  })
  .post("/decks", async (c) => {
    const body = await parseJson(c, createSchema);
    const source = body.source ?? (c.var.authMethod === "apikey" ? "ai" : "manual");
    const deck = createDeck(currentUser(c).id, { ...body, source });
    return c.json({ deck: withDetails(deck, cardsMap()) }, 201);
  })
  .get("/decks/:id", (c) => c.json({ deck: withDetails(ownedDeck(c), cardsMap()) }))
  .patch("/decks/:id", async (c) => {
    const id = deckId(c);
    const patch = await parseJson(c, patchSchema);
    return c.json({ deck: withDetails(updateDeck(currentUser(c).id, id, patch), cardsMap()) });
  })
  .delete("/decks/:id", (c) => {
    if (!deleteDeck(currentUser(c).id, deckId(c))) throw notFound("Deck");
    return c.body(null, 204);
  })
  .get("/decks/:id/check", (c) => {
    const deck = ownedDeck(c);
    const { tag } = parseQuery(c, z.object({ tag: z.string().min(1) }));
    const player = assertPlayerOwnedBy(normalizeTag(tag), currentUser(c).id);
    const catalog = listCards();
    const avgElixir = averageElixir(deck.cards, new Map(catalog.map((card) => [card.name, card])));
    const snap = getLatestSnapshot(player.tag);
    const { entries } = buildCollection(snap?.player ?? null, catalog);
    const byName = new Map(entries.map((e) => [e.name, e]));
    // Without a snapshot ownership is unknown, not "missing"; reporting all 8 as missing misleads the AI.
    if (!snap) {
      const cards = deck.cards.map((name) => ({
        name,
        level: null,
        maxLevel: byName.get(name)?.maxLevel ?? null,
        owned: null,
        evolutionLevel: null,
      }));
      return c.json({ fetchedAt: null, lastSeenAt: null, cards, avgElixir, missing: [], note: "no snapshot yet" });
    }
    const cards = deck.cards.map((name) => {
      const e = byName.get(name);
      return {
        name,
        level: e?.level ?? null,
        maxLevel: e?.maxLevel ?? null,
        owned: e?.owned ?? false,
        evolutionLevel: e?.evolutionLevel ?? 0,
      };
    });
    return c.json({
      fetchedAt: snap.fetchedAt,
      lastSeenAt: snap.lastSeenAt,
      cards,
      avgElixir,
      missing: cards.filter((card) => !card.owned).map((card) => card.name),
    });
  });
