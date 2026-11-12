/**
 * Card Boost: during its window a boosted card plays at the player's King Tower level when that is higher than
 * its own level, in every mode that uses the player's collection (Supercell support, "Card Boost").
 * The official API has no boost field and reports real levels, so the schedule is kept here by hand.
 *
 * To add or adjust a boost, edit BOOST_SCHEDULE: one entry per window, `from`/`until` inclusive UTC dates.
 * Card names must match the API's exact spelling; `bun run cli boost list` flags names the catalog doesn't know.
 * The in-game rollover hour isn't published, so a boost may show a few hours early or late on the edge days.
 */
export interface BoostWindow {
  cards: string[];
  from: string;
  until: string;
  label: string;
}

export const BOOST_SCHEDULE: BoostWindow[] = [
  // RoyaleAPI, "Season 89 King vs King": Giant and Mirror boosted for the full season.
  { label: "Season 89 (King vs King)", from: "2026-11-02", until: "2026-12-07", cards: ["Giant", "Mirror"] },
  // King of Cards event (timesaver.gg, theclick.gg): each week's cards are boosted for that week only.
  {
    label: "King of Cards week 2",
    from: "2026-11-09",
    until: "2026-11-15",
    cards: ["Battle Ram", "Hog Rider", "Mortar", "Minion Giant", "Goblin Barrel"],
  },
  {
    label: "King of Cards week 3",
    from: "2026-11-16",
    until: "2026-11-22",
    cards: ["Balloon", "Royal Hogs", "Three Musketeers", "Royal Giant", "Ram Rider", "Wall Breakers"],
  },
  {
    label: "King of Cards week 4",
    from: "2026-11-23",
    until: "2026-11-29",
    cards: ["Goblin Giant", "Skeleton Barrel", "Golem", "Electro Giant", "Lava Hound", "Elixir Golem"],
  },
  {
    label: "King of Cards week 5",
    from: "2026-11-30",
    until: "2026-12-07",
    cards: ["X-Bow", "Miner", "Graveyard", "Goblin Drill"],
  },
];

// Supercell: boosts start at King Tower level 7.
export const MIN_BOOST_KING_TOWER = 7;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems that would make a window silently wrong; names are checked against the catalog by the CLI instead. */
export function scheduleProblems(schedule: BoostWindow[]): string[] {
  const problems: string[] = [];
  for (const w of schedule) {
    const where = `"${w.label}"`;
    for (const [field, value] of [["from", w.from], ["until", w.until]] as const) {
      // A string comparison is only a date comparison for zero-padded YYYY-MM-DD that is a real day.
      const ms = Date.parse(`${value}T00:00:00Z`);
      if (!ISO_DATE.test(value) || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
        problems.push(`${where}: ${field} "${value}" is not a YYYY-MM-DD date`);
      }
    }
    if (w.from > w.until) problems.push(`${where}: from ${w.from} is after until ${w.until}`);
    if (!w.cards.length) problems.push(`${where}: no cards`);
    const seen = new Set<string>();
    for (const name of w.cards) {
      if (name !== name.trim() || !name) problems.push(`${where}: card name "${name}" is blank or padded`);
      if (seen.has(name)) problems.push(`${where}: ${name} listed twice`);
      seen.add(name);
    }
  }
  return problems;
}

// Fail at import so a bad edit breaks the test run and startup instead of hiding a boost.
const problems = scheduleProblems(BOOST_SCHEDULE);
if (problems.length) throw new Error(`BOOST_SCHEDULE is invalid:\n  ${problems.join("\n  ")}`);

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
