import { describe, expect, test } from "bun:test";
import { upgradableNow } from "../../src/domain/upgradeTable";

describe("upgradableNow", () => {
  test("leftover copies carry into the next upgrade", () => {
    // Common 11→12 costs 1,500 copies and 25,000 gold; 12→13 costs 2,500 and 40,000.
    expect(upgradableNow("common", 11, 4000)).toEqual({ levels: 2, toLevel: 13, gold: 65000, copiesLeft: 0 });
    expect(upgradableNow("Common", 11, 4100)).toEqual({ levels: 2, toLevel: 13, gold: 65000, copiesLeft: 100 });
    expect(upgradableNow("champion", 11, 7)).toEqual({ levels: 2, toLevel: 13, gold: 65000, copiesLeft: 0 });
  });

  test("zero levels when the next step isn't covered", () => {
    expect(upgradableNow("common", 11, 1499)).toEqual({ levels: 0, toLevel: 11, gold: 0, copiesLeft: 1499 });
    expect(upgradableNow("mythic", 11, 9999).levels).toBe(0);
  });

  test("stops at the max level", () => {
    expect(upgradableNow("legendary", 15, 1000)).toEqual({ levels: 1, toLevel: 16, gold: 120000, copiesLeft: 980 });
    expect(upgradableNow("legendary", 16, 1000).levels).toBe(0);
    expect(upgradableNow("legendary", 13, 1000, 14)).toMatchObject({ levels: 1, toLevel: 14 });
  });
});
