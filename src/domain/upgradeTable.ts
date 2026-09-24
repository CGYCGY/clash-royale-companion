import type { Rarity } from "../cr/types";

/**
 * In-game upgrade costs after the November 24, 2025 economy overhaul: Elite Wild Cards are gone,
 * the cap is display level 16, and every step costs copies plus gold. 10→11 gold is 15,000; two
 * sources disagreed, and 15,000 is the value that matches the published 365,625 total for 1→16.
 */
export const MAX_DISPLAY_LEVEL = 16;

/** Gold to go from display level L to L+1, the same for every rarity. Index 0 is 1→2. */
const GOLD = [5, 20, 50, 150, 400, 1000, 2000, 4000, 8000, 15000, 25000, 40000, 60000, 90000, 120000];

/** Copies to go from display level L to L+1. Index 0 is the rarity's starting level. */
const COPIES: Record<Rarity, { start: number; steps: number[] }> = {
  common: { start: 1, steps: [2, 4, 10, 20, 50, 100, 200, 400, 800, 1000, 1500, 2500, 3500, 5500, 7500] },
  rare: { start: 3, steps: [2, 4, 10, 20, 50, 100, 200, 300, 400, 550, 750, 1000, 1400] },
  epic: { start: 6, steps: [2, 4, 10, 20, 30, 50, 70, 100, 130, 180] },
  legendary: { start: 9, steps: [2, 4, 6, 9, 12, 14, 20] },
  champion: { start: 11, steps: [2, 5, 8, 11, 15] },
};

const table = (rarity: string) => COPIES[rarity.toLowerCase() as Rarity];

/** Copies for the next level; null for an unknown rarity or a level outside the rarity's range. */
export function copiesForNextLevel(rarity: string, displayLevel: number): number | null {
  const t = table(rarity);
  return t?.steps[displayLevel - t.start] ?? null;
}

/** Gold for the next level; null outside 1..15. */
export function goldForNextLevel(displayLevel: number): number | null {
  return GOLD[displayLevel - 1] ?? null;
}

function sumSteps(
  rarity: string,
  fromLevel: number,
  toLevel: number,
  step: (level: number) => number | null,
): number | null {
  const t = table(rarity);
  if (!t || fromLevel < t.start || toLevel > MAX_DISPLAY_LEVEL || fromLevel > toLevel) return null;
  let total = 0;
  for (let level = fromLevel; level < toLevel; level++) {
    const cost = step(level);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

/** Total gold from `fromLevel` up to `toLevel` (default 16); null when the range is outside the table. */
export const goldToMax = (rarity: string, fromLevel: number, toLevel = MAX_DISPLAY_LEVEL): number | null =>
  sumSteps(rarity, fromLevel, toLevel, goldForNextLevel);

/** Total copies from `fromLevel` up to `toLevel` (default 16), ignoring copies already held. */
export const copiesToMax = (rarity: string, fromLevel: number, toLevel = MAX_DISPLAY_LEVEL): number | null =>
  sumSteps(rarity, fromLevel, toLevel, (level) => copiesForNextLevel(rarity, level));
