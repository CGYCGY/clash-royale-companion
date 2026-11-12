import { afterEach, describe, expect, test } from "bun:test";
import {
  activeBoosts,
  BOOST_SCHEDULE,
  boostedLevel,
  type BoostWindow,
  scheduleProblems,
} from "../../src/domain/boostedCards";
import { buildCollection, type CollectionEntry, projectAffordable } from "../../src/domain/collection";
import type { PlayerCard } from "../../src/cr/types";

const card = (over: Partial<PlayerCard>): PlayerCard => ({
  id: 26000003,
  name: "Giant",
  level: 6,
  maxLevel: 14,
  rarity: "rare",
  count: 0,
  elixirCost: 5,
  iconUrls: { medium: "" },
  ...over,
});

const window = (over: Partial<BoostWindow> = {}): BoostWindow => ({
  cards: ["Giant", "Mirror"],
  from: "2026-11-02",
  until: "2026-12-07",
  label: "Season 89",
  ...over,
});

afterEach(() => {
  BOOST_SCHEDULE.splice(0);
});

describe("activeBoosts", () => {
  test("both edge days count, the days outside don't", () => {
    const schedule = [window()];
    expect([...activeBoosts(new Date("2026-11-01T23:59:59Z"), schedule).keys()]).toEqual([]);
    expect([...activeBoosts(new Date("2026-11-02T00:00:00Z"), schedule).keys()]).toEqual(["Giant", "Mirror"]);
    expect(activeBoosts(new Date("2026-12-07T23:59:59Z"), schedule).get("Giant")).toEqual({
      until: "2026-12-07",
      label: "Season 89",
    });
    expect(activeBoosts(new Date("2026-12-08T00:00:00Z"), schedule).size).toBe(0);
  });

  test("overlapping windows keep the later end date", () => {
    const schedule = [
      window(),
      window({ cards: ["Giant", "Hog Rider"], from: "2026-11-09", until: "2026-11-15", label: "Week 2" }),
    ];
    const active = activeBoosts(new Date("2026-11-10T12:00:00Z"), schedule);
    expect(active.get("Giant")!.until).toBe("2026-12-07");
    expect(active.get("Hog Rider")).toEqual({ until: "2026-11-15", label: "Week 2" });
    expect(activeBoosts(new Date("2026-11-16T00:00:00Z"), schedule).has("Hog Rider")).toBe(false);
  });
});

describe("scheduleProblems", () => {
  test("a well-formed schedule has none", () => {
    expect(scheduleProblems([window(), window({ from: "2026-12-07" })])).toEqual([]);
  });

  test("flags dates that wouldn't compare correctly, reversed windows, and bad card lists", () => {
    expect(
      scheduleProblems([
        window({ label: "a", from: "2026-11-9" }),
        window({ label: "b", until: "2026-12-32" }),
        window({ label: "c", from: "2026-12-08" }),
        window({ label: "d", cards: [] }),
        window({ label: "e", cards: ["Giant", " Mirror", "Giant"] }),
      ]),
    ).toEqual([
      '"a": from "2026-11-9" is not a YYYY-MM-DD date',
      '"b": until "2026-12-32" is not a YYYY-MM-DD date',
      '"c": from 2026-12-08 is after until 2026-12-07',
      '"d": no cards',
      '"e": card name " Mirror" is blank or padded',
      '"e": Giant listed twice',
    ]);
  });
});

describe("boostedLevel", () => {
  test("raises to the King Tower level from King Tower 7 up", () => {
    expect(boostedLevel(8, 12)).toBe(12);
    expect(boostedLevel(12, 12)).toBeNull();
    expect(boostedLevel(13, 12)).toBeNull();
    expect(boostedLevel(3, 6)).toBeNull();
    expect(boostedLevel(5, 7)).toBe(7);
    expect(boostedLevel(null, 12)).toBeNull();
    expect(boostedLevel(8, undefined)).toBeNull();
  });
});

describe("collection entries", () => {
  const boosts = activeBoosts(new Date("2026-11-06T00:00:00Z"), [window()]);

  test("an owned boosted card plays at the King Tower level; level and costs stay real", () => {
    // Rare API level 6 of 14 is display level 8.
    const plain = buildCollection({ cards: [card({})], kingTowerLevel: 12 }, [], new Map()).entries[0]!;
    const giant = buildCollection({ cards: [card({})], kingTowerLevel: 12 }, [], boosts).entries[0]!;
    expect(giant).toMatchObject({ level: 8, boostedLevel: 12, boostedUntil: "2026-12-07" });
    expect({ ...giant, boostedLevel: null, boostedUntil: null } as CollectionEntry).toEqual(plain);
  });

  test("not boosted when the card already reaches the King Tower level, or isn't in the window", () => {
    const high = buildCollection({ cards: [card({ level: 11 })], kingTowerLevel: 12 }, [], boosts).entries[0]!;
    expect(high).toMatchObject({ level: 13, boostedLevel: null, boostedUntil: "2026-12-07" });
    const other = buildCollection(
      { cards: [card({ id: 26000021, name: "Hog Rider" })], kingTowerLevel: 12 },
      [],
      boosts,
    ).entries[0]!;
    expect(other).toMatchObject({ boostedLevel: null, boostedUntil: null });
  });

  test("tower troops are never boosted", () => {
    const tower = card({ id: 159000000, name: "Giant" });
    const entry = buildCollection({ cards: [], supportCards: [tower], kingTowerLevel: 12 }, [], boosts).entries[0]!;
    expect(entry).toMatchObject({ kind: "support", boostedLevel: null, boostedUntil: null });
  });

  test("the Max Out preview drops the boost once the copies reach it", () => {
    // Rare display 8 → 9 needs 100 copies, 9 → 10 needs 200: 150 copies buy one level, 400 buy two.
    const one = buildCollection({ cards: [card({ count: 150 })], kingTowerLevel: 9 }, [], boosts).entries[0]!;
    expect(one.boostedLevel).toBe(9);
    expect(projectAffordable(one)).toMatchObject({ level: 9, boostedLevel: null, boostedUntil: "2026-12-07" });
    const short = buildCollection({ cards: [card({ count: 150 })], kingTowerLevel: 12 }, [], boosts).entries[0]!;
    expect(projectAffordable(short)).toMatchObject({ level: 9, boostedLevel: 12 });
  });
});
