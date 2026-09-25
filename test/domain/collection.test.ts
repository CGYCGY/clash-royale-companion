import { describe, expect, test } from "bun:test";
import { buildCollection, projectAffordable, summarizeCollection } from "../../src/domain/collection";
import type { PlayerCard } from "../../src/cr/types";
import { copiesToMax, goldToMax } from "../../src/domain/upgradeTable";

const card = (over: Partial<PlayerCard>): PlayerCard => ({
  id: 26000000,
  name: "Mortar",
  level: 1,
  maxLevel: 16,
  rarity: "common",
  count: 0,
  elixirCost: 4,
  iconUrls: { medium: "" },
  ...over,
});

const entryOf = (c: PlayerCard) => buildCollection({ cards: [c] }, []).entries[0]!;

describe("projectAffordable", () => {
  test("raises the level as far as the copies go and keeps the leftover copies", () => {
    // Common 1→7 costs 2+4+10+20+50+100 = 186 copies and 1,625 gold; 7→8 needs 200.
    const before = entryOf(card({ level: 1, count: 190 }));
    expect(before).toMatchObject({ level: 1, upgradeReady: true, upgradableLevels: 6, upgradableGold: 1625 });

    expect(projectAffordable(before)).toMatchObject({
      level: 7,
      count: 4,
      countNeeded: 200,
      goldNeeded: 2000,
      goldToMax: goldToMax("common", 7),
      copiesToMax: copiesToMax("common", 7)! - 4,
      upgradeReady: false,
      upgradableLevels: 0,
      upgradableGold: 0,
      levelsToMax: 9,
    });
  });

  test("stops at the max level", () => {
    const projected = projectAffordable(entryOf(card({ level: 15, count: 8000 })));
    expect(projected).toMatchObject({
      level: 16,
      count: 500,
      countNeeded: null,
      goldNeeded: null,
      goldToMax: 0,
      upgradeReady: false,
      levelsToMax: 0,
    });
  });

  test("leaves cards with nothing affordable, and unowned cards, untouched", () => {
    const short = entryOf(card({ level: 1, count: 1 }));
    expect(projectAffordable(short)).toBe(short);
    const maxed = entryOf(card({ level: 16, count: 50 }));
    expect(projectAffordable(maxed)).toBe(maxed);
  });

  test("the summary of projected entries counts the new maxes and no upgrade-ready cards", () => {
    const entries = buildCollection(
      {
        cards: [
          card({ id: 1, name: "A", level: 15, count: 7500 }),
          card({ id: 2, name: "B", level: 1, count: 2 }),
          card({ id: 3, name: "C", level: 16 }),
        ],
      },
      [],
    ).entries;
    expect(summarizeCollection(entries)).toMatchObject({ maxed: 1, upgradeReady: 2 });
    const projected = summarizeCollection(entries.map(projectAffordable));
    expect(projected).toMatchObject({ maxed: 2, upgradeReady: 0 });
    expect(projected.byRarity[0]!.avgLevel).toBe(11.33);
  });
});
