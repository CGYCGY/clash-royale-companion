import { beforeEach, describe, expect, test } from "bun:test";
import { AppError } from "../src/errors";
import {
  createDeck,
  deleteDeck,
  getDeck,
  listDecks,
  MAX_DECK_TAG_CHARS,
  MAX_DECK_TAGS,
  normalizeDeckTags,
  updateDeck,
  validateDeckCards,
} from "../src/repos/decks";
import type { User } from "../src/types";
import { makeTestDb, makeUser, seedCards } from "./helpers";

const HOG = ["Hog Rider", "Musketeer", "Ice Golem", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"];

let alice: User;
let bob: User;

beforeEach(() => {
  makeTestDb();
  seedCards();
  alice = makeUser("alice");
  bob = makeUser("bob");
});

const invalid = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected AppError");
};

describe("validateDeckCards", () => {
  test("canonicalizes case and whitespace", () => {
    expect(validateDeckCards(HOG.map((n) => ` ${n.toLowerCase()} `))).toEqual(HOG);
  });

  test("reports unknown cards", () => {
    const err = invalid(() => validateDeckCards([...HOG.slice(0, 7), "Hog Ryder"]));
    expect(err.code).toBe("invalid_deck");
    expect(err.details).toMatchObject({ unknown: ["Hog Ryder"] });
  });

  test("rejects wrong count, duplicates, and tower troops", () => {
    expect(invalid(() => validateDeckCards(HOG.slice(0, 7))).message).toContain("exactly 8");
    expect(invalid(() => validateDeckCards([...HOG.slice(0, 7), "hog rider"])).details).toMatchObject({
      duplicates: ["Hog Rider"],
    });
    expect(invalid(() => validateDeckCards([...HOG.slice(0, 7), "Tower Princess"])).details).toMatchObject({
      unknown: ["Tower Princess"],
    });
  });
});

describe("deck CRUD", () => {
  test("create, list, update, delete are owner-scoped", () => {
    const deck = createDeck(alice.id, { name: " Hog 2.6 ", cards: HOG, notes: "**cycle**", source: "ai" });
    expect(deck).toMatchObject({ name: "Hog 2.6", cards: HOG, notes: "**cycle**", source: "ai" });
    expect(listDecks(alice.id)).toHaveLength(1);
    expect(listDecks(bob.id)).toHaveLength(0);
    expect(getDeck(bob.id, deck.id)).toBeNull();

    expect(invalid(() => updateDeck(bob.id, deck.id, { name: "x" })).code).toBe("not_found");
    const swapped = [...HOG.slice(0, 7), "Earthquake"];
    const updated = updateDeck(alice.id, deck.id, { cards: swapped, notes: "v2" });
    expect(updated).toMatchObject({ name: "Hog 2.6", cards: swapped, notes: "v2", source: "ai" });
    expect(invalid(() => updateDeck(alice.id, deck.id, { cards: ["Knight"] })).code).toBe("invalid_deck");

    expect(deleteDeck(bob.id, deck.id)).toBe(false);
    expect(deleteDeck(alice.id, deck.id)).toBe(true);
    expect(listDecks(alice.id)).toHaveLength(0);
  });
});

describe("slot 3 form", () => {
  // Knight has Evo + Hero, Giant only Hero, Archers only Evo.
  const deckWith = (slot3: string) => ["Hog Rider", "Musketeer", slot3, "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"];

  test("persists, defaults to null, and normalises forms the card can't take", () => {
    expect(createDeck(alice.id, { name: "a", cards: deckWith("Knight") }).slot3Form).toBeNull();
    const hero = createDeck(alice.id, { name: "b", cards: deckWith("Knight"), slot3Form: "hero" });
    expect(getDeck(alice.id, hero.id)!.slot3Form).toBe("hero");
    expect(createDeck(alice.id, { name: "c", cards: deckWith("Archers"), slot3Form: "hero" }).slot3Form).toBeNull();
    expect(createDeck(alice.id, { name: "d", cards: deckWith("Giant"), slot3Form: "evo" }).slot3Form).toBeNull();
  });

  test("update keeps it when omitted, clears it with null, and drops it when the card changes", () => {
    const deck = createDeck(alice.id, { name: "a", cards: deckWith("Knight"), slot3Form: "hero" });
    expect(updateDeck(alice.id, deck.id, { name: "renamed" }).slot3Form).toBe("hero");
    expect(updateDeck(alice.id, deck.id, { slot3Form: null }).slot3Form).toBeNull();
    expect(updateDeck(alice.id, deck.id, { slot3Form: "evo" }).slot3Form).toBe("evo");
    expect(updateDeck(alice.id, deck.id, { cards: deckWith("Giant") }).slot3Form).toBeNull();
  });
});

describe("deck tags", () => {
  test("normalizeDeckTags trims, collapses spaces, drops empties and case-insensitive dupes", () => {
    expect(normalizeDeckTags(["  Clan   War ", "", "   ", "clan war", "Triple Elixir", "TRIPLE elixir"])).toEqual([
      "Clan War",
      "Triple Elixir",
    ]);
  });

  test("normalizeDeckTags truncates long tags and caps the count", () => {
    expect(normalizeDeckTags(["x".repeat(MAX_DECK_TAG_CHARS + 5)])).toEqual(["x".repeat(MAX_DECK_TAG_CHARS)]);
    const many = Array.from({ length: MAX_DECK_TAGS + 3 }, (_, i) => `Mode ${i}`);
    expect(normalizeDeckTags(many)).toEqual(many.slice(0, MAX_DECK_TAGS));
  });

  test("create stores normalized tags, defaulting to none", () => {
    expect(createDeck(alice.id, { name: "a", cards: HOG }).tags).toEqual([]);
    const deck = createDeck(alice.id, { name: "b", cards: HOG, tags: [" Clan War", "clan war", "Touchdown"] });
    expect(getDeck(alice.id, deck.id)!.tags).toEqual(["Clan War", "Touchdown"]);
  });

  test("update keeps tags when omitted, replaces them when given, and clears them with []", () => {
    const deck = createDeck(alice.id, { name: "a", cards: HOG, tags: ["Clan War"] });
    expect(updateDeck(alice.id, deck.id, { name: "renamed" }).tags).toEqual(["Clan War"]);
    expect(updateDeck(alice.id, deck.id, { tags: ["Triple Elixir", " triple ELIXIR "] }).tags).toEqual(["Triple Elixir"]);
    expect(updateDeck(alice.id, deck.id, { tags: [] }).tags).toEqual([]);
    expect(getDeck(alice.id, deck.id)!.tags).toEqual([]);
  });
});
