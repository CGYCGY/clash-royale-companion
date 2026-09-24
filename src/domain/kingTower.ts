import { displayLevel } from "../cr/levels";
import type { Player } from "../cr/types";
import type { CardRecord } from "../repos/cards";

// Supercell, "New Collection Levels and Mastery Changes" (2026-05-26): King Tower level N needs
// `cards` cards at display level `minLevel` or higher. Tower troops don't count, and the level
// never goes down. Checked against three live profiles (KT 13, 14, 16) on 2026-09-25.
const KING_TOWER_REQUIREMENTS: Record<number, { cards: number; minLevel: number }> = {
  2: { cards: 9, minLevel: 1 },
  3: { cards: 9, minLevel: 2 },
  4: { cards: 10, minLevel: 3 },
  5: { cards: 10, minLevel: 4 },
  6: { cards: 10, minLevel: 5 },
  7: { cards: 10, minLevel: 6 },
  8: { cards: 10, minLevel: 7 },
  9: { cards: 10, minLevel: 8 },
  10: { cards: 10, minLevel: 9 },
  11: { cards: 10, minLevel: 10 },
  12: { cards: 11, minLevel: 11 },
  13: { cards: 11, minLevel: 12 },
  14: { cards: 12, minLevel: 13 },
  15: { cards: 13, minLevel: 14 },
  16: { cards: 14, minLevel: 15 },
};

export const MAX_KING_TOWER_LEVEL = 16;

export interface NextKingTower {
  level: number;
  cards: number;
  minLevel: number;
  /** Regular cards already at minLevel or higher. */
  have: number;
}

/**
 * What the next King Tower level needs, or null when the level is unknown (snapshot from before
 * the field existed) or already maxed.
 */
export function nextKingTower(
  player: Pick<Player, "kingTowerLevel" | "cards">,
  catalog?: Map<number, CardRecord>,
): NextKingTower | null {
  const current = player.kingTowerLevel;
  if (current === undefined || current >= MAX_KING_TOWER_LEVEL) return null;
  const req = KING_TOWER_REQUIREMENTS[current + 1];
  if (!req) return null;
  const have = (player.cards ?? []).filter(
    (c) => displayLevel(c.level, c.rarity ?? catalog?.get(c.id)?.rarity) >= req.minLevel,
  ).length;
  return { level: current + 1, ...req, have };
}
