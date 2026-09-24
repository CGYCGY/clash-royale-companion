import { describe, expect, test } from "bun:test";
import { classifyDecks, type UsedDeckStats } from "../../src/domain/deckUsage";
import type { DeckRecord } from "../../src/repos/decks";

const A = ["Hog Rider", "Musketeer", "Ice Golem", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"];
const B = ["Golem", "Night Witch", "Baby Dragon", "Lumberjack", "Tornado", "Lightning", "Barbarian Barrel", "Mega Minion"];
const C = ["X-Bow", "Tesla", "Archers", "Knight", "Skeletons", "Ice Spirit", "Fireball", "The Log"];

const used = (cards: string[], lastPlayed: string, games = 4): UsedDeckStats => ({
  deckKey: [...cards].sort().join("|"),
  cards: [...cards].sort(),
  avgElixir: 3,
  lastPlayed,
  games,
  wins: games / 2,
  losses: games / 2,
  draws: 0,
  winRate: 0.5,
});

const saved = (id: number, cards: string[]): DeckRecord => ({
  id,
  userId: 1,
  name: `Deck ${id}`,
  cards,
  notes: "",
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("classifyDecks", () => {
  test("a saved deck matching a used one (any order, any case) takes its stats and hides it from Used", () => {
    const r = classifyDecks([saved(1, [...A].reverse().map((n) => n.toUpperCase()))], [used(A, "2026-09-02"), used(B, "2026-09-01")], null);
    expect(r.saved).toHaveLength(1);
    expect(r.saved[0]!.stats?.lastPlayed).toBe("2026-09-02");
    expect(r.used.map((u) => u.stats?.lastPlayed)).toEqual(["2026-09-01"]);
  });

  test("the equipped deck is marked in use and listed first wherever it is", () => {
    const inUsed = classifyDecks([saved(1, B)], [used(A, "2026-09-03"), used(C, "2026-09-02")], [...C].reverse());
    expect(inUsed.used.map((u) => [u.cards.includes("X-Bow"), u.inUse])).toEqual([
      [true, true],
      [false, false],
    ]);
    expect(inUsed.saved[0]!.inUse).toBe(false);

    const inSaved = classifyDecks([saved(1, B), saved(2, C)], [used(C, "2026-09-02")], C);
    expect(inSaved.saved.map((s) => [s.deck.id, s.inUse])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(inSaved.used).toEqual([]);
  });

  test("an equipped deck with no stored battles still shows, without stats", () => {
    const r = classifyDecks([], [used(A, "2026-09-02")], B);
    expect(r.used[0]).toEqual({ cards: B, stats: null, inUse: true });
    expect(r.used).toHaveLength(2);
  });

  test("used decks are newest first and empty decks are skipped", () => {
    const r = classifyDecks([], [used(A, "2026-09-01", 9), used([], "2026-09-05"), used(B, "2026-09-03", 1)], null);
    expect(r.used.map((u) => u.stats!.lastPlayed)).toEqual(["2026-09-03", "2026-09-01"]);
  });
});
