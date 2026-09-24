import type { Rarity } from "./types";

// The API reports levels relative to each rarity's first level (a fresh legendary is level 1),
// while the game shows a common-based scale (the same legendary shows as 9).
const RARITY_OFFSET: Record<Rarity, number> = {
  common: 0,
  rare: 2,
  epic: 5,
  legendary: 8,
  champion: 10,
};

export function displayLevel(apiLevel: number, rarity: Rarity | string | undefined | null): number {
  const offset = rarity ? (RARITY_OFFSET[rarity.toLowerCase() as Rarity] ?? 0) : 0;
  return apiLevel + offset;
}
