/**
 * Seasonal Card Boost: during its window a boosted card plays at the player's King Tower level when that is
 * higher than its own level, in every mode that uses the player's collection (Supercell support, "Card Boost").
 * The official API has no boost field and reports real levels, so the schedule is kept here by hand.
 *
 * Update this list when a season or a weekly boost starts. `from` and `until` are inclusive UTC dates; the
 * in-game rollover hour isn't published, so a boost may show a few hours early or late on the edge days.
 */
export interface BoostWindow {
  cards: string[];
  from: string;
  until: string;
  label: string;
}

export const BOOST_SCHEDULE: BoostWindow[] = [
  // RoyaleAPI, "Season 89 King vs King": Giant and Mirror boosted for the full season.
  { cards: ["Giant", "Mirror"], from: "2026-11-02", until: "2026-12-07", label: "Season 89 (King vs King)" },
];

// Supercell: boosts start at King Tower level 7.
export const MIN_BOOST_KING_TOWER = 7;

export interface ActiveBoost {
  until: string;
  label: string;
}

/** Boosted card names on `now`'s UTC date; when windows overlap, the one ending last wins. */
export function activeBoosts(now: Date = new Date(), schedule: BoostWindow[] = BOOST_SCHEDULE): Map<string, ActiveBoost> {
  const day = now.toISOString().slice(0, 10);
  const active = new Map<string, ActiveBoost>();
  for (const w of schedule) {
    if (day < w.from || day > w.until) continue;
    for (const name of w.cards) {
      const prev = active.get(name);
      if (!prev || prev.until < w.until) active.set(name, { until: w.until, label: w.label });
    }
  }
  return active;
}

/** The level a boosted card plays at, or null when the boost doesn't raise it. */
export function boostedLevel(level: number | null, kingTowerLevel: number | undefined): number | null {
  if (level === null || kingTowerLevel === undefined || kingTowerLevel < MIN_BOOST_KING_TOWER) return null;
  return kingTowerLevel > level ? kingTowerLevel : null;
}
