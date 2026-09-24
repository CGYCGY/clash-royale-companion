import { displayLevel } from "../cr/levels";
import type { PlayerCard } from "../cr/types";
import type { DeckCard } from "../repos/battles";
import type { CardRecord } from "../repos/cards";
import { type CardView, toCardView } from "./components";

/** Snapshot cards carry raw API levels; battle-log cards may omit rarity, so fall back to the catalog. */
export function playerCardView(card: PlayerCard, catalog: Map<string, CardRecord>): CardView {
  const rarity = card.rarity ?? catalog.get(card.name)?.rarity;
  const view = toCardView(
    { name: card.name, level: displayLevel(card.level, rarity), evolutionLevel: card.evolutionLevel ?? 0 },
    catalog,
  );
  return { ...view, iconUrl: view.iconUrl ?? card.iconUrls.medium ?? null, iconUrlEvo: view.iconUrlEvo ?? card.iconUrls.evolutionMedium ?? null };
}

export const deckCardViews = (cards: DeckCard[], catalog: Map<string, CardRecord>): CardView[] =>
  cards.map((c) => toCardView(c, catalog));

export const namedCardViews = (names: string[], catalog: Map<string, CardRecord>): CardView[] =>
  names.map((name) => toCardView({ name }, catalog));

export const formatElixir = (avg: number | null): string => (avg === null ? "–" : avg.toFixed(1));
