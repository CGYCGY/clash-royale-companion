import type { BattleStats } from "../repos/battles";
import type { DeckRecord } from "../repos/decks";

export type UsedDeckStats = BattleStats["byDeck"][number];

export interface SavedDeckUsage {
  deck: DeckRecord;
  /** Battle stats of the used deck with the same eight cards, if the player has played it. */
  stats: UsedDeckStats | null;
  inUse: boolean;
}

export interface UsedDeckUsage {
  cards: string[];
  /** Null only for the equipped deck when no stored battle used it yet. */
  stats: UsedDeckStats | null;
  inUse: boolean;
}

export interface DeckUsage {
  saved: SavedDeckUsage[];
  used: UsedDeckUsage[];
}

// Saved decks store catalog names and battles store API names; they agree today, but case is cheap insurance.
const keyOf = (names: string[]): string => names.map((n) => n.toLowerCase()).sort().join("|");

/**
 * Joins the user's saved decks with the decks the current player used in battles and the one it has
 * equipped, matching on the card set regardless of order. A used deck that matches a saved one lends
 * it its stats and is left out of `used`, so no deck is listed twice. The equipped deck comes first
 * in whichever list holds it, and is added to `used` even before any battle with it is stored.
 */
export function classifyDecks(saved: DeckRecord[], used: UsedDeckStats[], currentDeck: string[] | null): DeckUsage {
  const currentKey = currentDeck?.length ? keyOf(currentDeck) : null;
  const usedByKey = new Map<string, UsedDeckStats>();
  for (const d of used) if (d.cards.length) usedByKey.set(keyOf(d.cards), d);

  const claimed = new Set<string>();
  const savedOut = saved.map((deck) => {
    const key = keyOf(deck.cards);
    const stats = usedByKey.get(key) ?? null;
    if (stats) claimed.add(key);
    return { deck, stats, inUse: key === currentKey };
  });

  const usedOut: UsedDeckUsage[] = [...usedByKey]
    .filter(([key]) => !claimed.has(key))
    .sort(([, a], [, b]) => b.lastPlayed.localeCompare(a.lastPlayed))
    .map(([key, stats]) => ({ cards: stats.cards, stats, inUse: key === currentKey }));
  const equippedListed = currentKey !== null && (usedByKey.has(currentKey) || savedOut.some((s) => s.inUse));
  if (currentKey !== null && !equippedListed) usedOut.unshift({ cards: currentDeck!, stats: null, inUse: true });

  const inUseFirst = <T extends { inUse: boolean }>(xs: T[]) => [...xs.filter((x) => x.inUse), ...xs.filter((x) => !x.inUse)];
  return { saved: inUseFirst(savedOut), used: inUseFirst(usedOut) };
}
