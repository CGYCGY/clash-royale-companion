import { describe, expect, test } from "bun:test";
import {
  classifyDecks,
  classifyVariants,
  equippedVariantKey,
  latestVariant,
  savedDeckVariantKey,
  type UsedDeckStats,
  variantFormsLabel,
  variantsByRecency,
} from "../../src/domain/deckUsage";
import { type DeckVariantStats, type VariantCard, variantKeyOf } from "../../src/repos/battles";
import type { DeckRecord, SlotForm } from "../../src/repos/decks";

const A = ["Hog Rider", "Musketeer", "Ice Golem", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"];
const B = ["Golem", "Night Witch", "Baby Dragon", "Lumberjack", "Tornado", "Lightning", "Barbarian Barrel", "Mega Minion"];
const C = ["X-Bow", "Tesla", "Archers", "Knight", "Skeletons", "Ice Spirit", "Fireball", "The Log"];

const used = (cards: string[], lastPlayed: string, games = 4): UsedDeckStats => ({
  deckKey: [...cards].sort().join("|"),
  cards: [...cards].sort(),
  avgElixir: 3,
  lastPlayed,
  modeTags: ["Trophy Road"],
  games,
  wins: games / 2,
  losses: games / 2,
  draws: 0,
  winRate: 0.5,
  variants: [],
});

const saved = (id: number, cards: string[], slot3Form: SlotForm | null = null): DeckRecord => ({
  id,
  userId: 1,
  name: `Deck ${id}`,
  cards,
  notes: "",
  source: "manual",
  slot3Form,
  tags: [],
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

// Slot rules for A: Hog Rider has no forms, Musketeer (slot 2) has Evo + Hero, Ice Golem (slot 3) Hero only.
const CATALOG = new Map<string, { maxEvolutionLevel: number | null }>([
  ["Hog Rider", { maxEvolutionLevel: null }],
  ["Musketeer", { maxEvolutionLevel: 3 }],
  ["Ice Golem", { maxEvolutionLevel: 2 }],
  ["Ice Spirit", { maxEvolutionLevel: 1 }],
  ["Skeletons", { maxEvolutionLevel: 1 }],
  ["Cannon", { maxEvolutionLevel: 1 }],
  ["Fireball", { maxEvolutionLevel: null }],
  ["The Log", { maxEvolutionLevel: null }],
]);

const forms = (names: string[], levels: Record<string, number>): VariantCard[] =>
  names.map((name) => ({ name, evolutionLevel: levels[name] ?? 0 }));

const variant = (cards: VariantCard[], lastPlayed: string, games = 2): DeckVariantStats => ({
  variantKey: variantKeyOf(cards),
  cards: [...cards].sort((a, b) => a.name.localeCompare(b.name)),
  lastPlayed,
  modeTags: ["Trophy Road"],
  games,
  wins: games,
  losses: 0,
  draws: 0,
  winRate: 1,
});

// Most games first, as getBattleStats returns them; the evo Skeletons form is the newer one.
const withVariants = (): UsedDeckStats => ({
  ...used(A, "2026-09-05", 7),
  variants: [
    variant(forms(A, { Musketeer: 2, "Ice Golem": 2 }), "2026-09-01", 5),
    variant(forms(A, { Skeletons: 1, Musketeer: 2 }), "2026-09-05", 2),
  ],
});

describe("variants", () => {
  test("latest-played variant first; a deck without variants stands in as one in base forms", () => {
    const stats = withVariants();
    expect(latestVariant(stats).variantKey).toBe(variantKeyOf(forms(A, { Skeletons: 1, Musketeer: 2 })));
    expect(variantsByRecency(stats).map((v) => v.lastPlayed)).toEqual(["2026-09-05", "2026-09-01"]);

    const old = used(A, "2026-09-02", 4);
    const [only, ...rest] = variantsByRecency(old);
    expect(rest).toEqual([]);
    expect(only!.cards.every((c) => c.evolutionLevel === 0)).toBe(true);
    expect(only!.cards.map((c) => c.name)).toEqual([...A].sort());
    expect(only!.variantKey).toBe(old.deckKey);
    expect([only!.games, only!.lastPlayed, only!.modeTags]).toEqual([4, "2026-09-02", ["Trophy Road"]]);
  });

  test("a saved deck's variant follows its slot rules", () => {
    // Slot 1 Hog Rider has no Evo, slot 2 Musketeer is Hero, slot 3 Ice Golem only has a Hero.
    expect(savedDeckVariantKey(saved(1, A), CATALOG)).toBe(variantKeyOf(forms(A, { Musketeer: 2, "Ice Golem": 2 })));
    // Slot 3 Cannon has only an Evo; slot 1 Skeletons is Evo.
    const order = ["Skeletons", "Musketeer", "Cannon", "Hog Rider", "Ice Golem", "Ice Spirit", "Fireball", "The Log"];
    expect(savedDeckVariantKey(saved(1, order, "hero"), CATALOG)).toBe(
      variantKeyOf(forms(order, { Skeletons: 1, Musketeer: 2, Cannon: 1 })),
    );
    // Slot 3 with both forms: the saved choice wins, Evo when none was made.
    const both = ["Hog Rider", "Ice Golem", "Musketeer", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"];
    expect(savedDeckVariantKey(saved(1, both, "hero"), CATALOG)).toBe(variantKeyOf(forms(both, { "Ice Golem": 2, Musketeer: 2 })));
    expect(savedDeckVariantKey(saved(1, both), CATALOG)).toBe(variantKeyOf(forms(both, { "Ice Golem": 2, Musketeer: 1 })));
  });

  test("the equipped variant is the slot's form intersected with the forms the player owns", () => {
    // The fixture's currentDeck: evolutionLevel is what the player owns, not what the slot shows.
    const deck = [
      { name: "Hog Rider" },
      { name: "Musketeer", evolutionLevel: 3 },
      { name: "Ice Golem", evolutionLevel: 2 },
      { name: "Ice Spirit", evolutionLevel: 1 },
      { name: "Skeletons" },
      { name: "Cannon" },
      { name: "Fireball" },
      { name: "The Log" },
    ];
    expect(equippedVariantKey(deck)).toBe(variantKeyOf(forms(A, { Musketeer: 2, "Ice Golem": 2 })));
    // Owned Evo in slot 2 isn't a Hero; slot 3 takes Evo when both are owned, Hero when only that is.
    const evoOnly = deck.map((c, i) => (i === 1 ? { ...c, evolutionLevel: 1 } : i === 2 ? { ...c, evolutionLevel: 3 } : c));
    expect(equippedVariantKey(evoOnly)).toBe(variantKeyOf(forms(A, { "Ice Golem": 1 })));
    // Slots: Skeletons, Hog Rider (no Hero), Musketeer (both owned, so Evo), Ice Golem (no form past slot 3).
    const firstEvo = [{ name: "Skeletons", evolutionLevel: 1 }, ...deck.filter((c) => c.name !== "Skeletons")];
    expect(equippedVariantKey(firstEvo)).toBe(variantKeyOf(forms(A, { Skeletons: 1, Musketeer: 1 })));
  });

  test("forms label", () => {
    expect(variantFormsLabel(forms(["Musketeer", "Skeletons", "Cannon"], { Skeletons: 1, Musketeer: 2 }))).toBe(
      "Hero Musketeer · Evo Skeletons",
    );
    expect(variantFormsLabel(forms(A, {}))).toBe("Base forms");
  });

  test("classifyVariants marks the equipped and saved variants, newest first", () => {
    const stats = withVariants();
    const equipped = A.map((name) => ({ name, evolutionLevel: CATALOG.get(name)!.maxEvolutionLevel ?? 0 }));
    const savedA = saved(3, [...A].reverse().map((n) => n.toUpperCase()));
    // Reversed, slot 1 is The Log and slot 3 Ice Spirit (Evo), so this saved deck matches no played variant.
    const savedOther = saved(4, [...A].reverse());
    const r = classifyVariants(stats, [saved(2, B), savedOther, saved(1, A)], equipped, CATALOG);
    expect(r.inUse).toBe(true);
    expect(r.saved.map((d) => d.id)).toEqual([4, 1]);
    expect(r.variants.map((v) => [v.variant.lastPlayed, v.inUse, v.savedAs?.id ?? null])).toEqual([
      ["2026-09-05", false, null],
      ["2026-09-01", true, 1],
    ]);

    // Variant keys compare case-insensitively, like deck keys.
    const upper = classifyVariants(stats, [savedA], null, CATALOG);
    expect(upper.inUse).toBe(false);
    expect(upper.variants.map((v) => v.savedAs?.id ?? null)).toEqual([null, null]);

    const other = classifyVariants(stats, [], B.map((name) => ({ name })), CATALOG);
    expect([other.inUse, other.variants.some((v) => v.inUse)]).toEqual([false, false]);
  });
});
