import { beforeEach, describe, expect, test } from "bun:test";
import { AppError } from "../src/errors";
import { createDeck, deleteDeck, getDeck, listDecks, updateDeck, validateDeckCards } from "../src/repos/decks";
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
