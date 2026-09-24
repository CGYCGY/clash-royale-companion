import { describe, expect, test } from "bun:test";
import type { Player, PlayerCard } from "../../src/cr/types";
import { nextKingTower } from "../../src/domain/kingTower";

const commons = (n: number, level: number): PlayerCard[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, name: `C${i}`, level, maxLevel: 16, rarity: "common", iconUrls: {} }));

describe("nextKingTower", () => {
  test("reports the published requirement for the next level and how many cards meet it", () => {
    const player = { kingTowerLevel: 14, cards: [...commons(10, 14), ...commons(5, 13)] };
    expect(nextKingTower(player)).toEqual({ level: 15, cards: 13, minLevel: 14, have: 10 });
    expect(nextKingTower({ ...player, kingTowerLevel: 13 })).toEqual({ level: 14, cards: 12, minLevel: 13, have: 15 });
    expect(nextKingTower({ kingTowerLevel: 1, cards: [] })).toEqual({ level: 2, cards: 9, minLevel: 1, have: 0 });
  });

  test("converts rarity-relative API levels before comparing", () => {
    // A legendary at API level 7 is display level 15.
    const legendary: PlayerCard = { id: 1, name: "L", level: 7, maxLevel: 8, rarity: "legendary", iconUrls: {} };
    expect(nextKingTower({ kingTowerLevel: 15, cards: [legendary] })!.have).toBe(1);
  });

  test("null when maxed or when the snapshot predates kingTowerLevel", () => {
    expect(nextKingTower({ kingTowerLevel: 16, cards: [] })).toBeNull();
    expect(nextKingTower({ cards: [] } as Pick<Player, "kingTowerLevel" | "cards">)).toBeNull();
  });
});
