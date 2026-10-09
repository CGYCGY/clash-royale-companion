import { type BattleStats, type DeckVariantStats, type VariantCard, variantKeyOf } from "../repos/battles";
import type { DeckRecord } from "../repos/decks";
import { deckSlotForms, slotFormsBitmask } from "./deckSlots";
import { formsLabel } from "./evolution";

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

export const sameCards = (a: string[], b: string[]): boolean => keyOf(a) === keyOf(b);
const sameVariant = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

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

type FormCatalog = Map<string, { maxEvolutionLevel: number | null }>;

/**
 * The deck's variants, most recently played first. getBattleStats always yields at least one, but stats
 * built by hand (tests, API clients) may carry none; the whole deck then stands in as one base-form variant.
 */
export function variantsByRecency(stats: UsedDeckStats): DeckVariantStats[] {
  if (!stats.variants.length) {
    const cards = stats.cards.map((name) => ({ name, evolutionLevel: 0 }));
    const { games, wins, losses, draws, winRate, lastPlayed, modeTags } = stats;
    return [{ variantKey: variantKeyOf(cards), cards, games, wins, losses, draws, winRate, lastPlayed, modeTags }];
  }
  return [...stats.variants].sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
}

export const latestVariant = (stats: UsedDeckStats): DeckVariantStats => variantsByRecency(stats)[0]!;

/** The forms a saved deck shows, by its slot rules (see deckSlotForms). */
export function savedDeckVariantKey(deck: Pick<DeckRecord, "cards" | "slot3Form">, catalog: FormCatalog): string {
  const forms = deckSlotForms(deck.cards, catalog, deck.slot3Form);
  return variantKeyOf(deck.cards.map((name, i) => ({ name, evolutionLevel: slotFormsBitmask(forms[i]!) })));
}

/**
 * The API's currentDeck[].evolutionLevel is the forms the player OWNS for that card (a Musketeer with both
 * reports 3 wherever it sits), not the form it is equipped in. The slot decides that, so the owned bits stand
 * in for the catalog's possible forms. Cards come in in-game slot order. A slot 3 card with both forms owned
 * is taken as Evo, like a saved deck with no choice; the API doesn't say which one is set.
 */
export function equippedVariantKey(currentDeck: { name: string; evolutionLevel?: number }[]): string {
  const owned = new Map(currentDeck.map((c) => [c.name, { maxEvolutionLevel: c.evolutionLevel ?? 0 }]));
  const names = currentDeck.map((c) => c.name);
  return savedDeckVariantKey({ cards: names, slot3Form: null }, owned);
}

/** "Evo Skeletons · Hero Musketeer", or "Base forms" when no card is in a special form. */
export function variantFormsLabel(cards: VariantCard[]): string {
  const parts = cards.filter((c) => c.evolutionLevel > 0).map((c) => `${formsLabel(c.evolutionLevel)} ${c.name}`);
  return parts.length ? parts.join(" · ") : "Base forms";
}

export interface VariantUsage {
  variant: DeckVariantStats;
  inUse: boolean;
  /** The first saved deck (in the order given) whose slot forms make this variant. */
  savedAs: DeckRecord | null;
}

export interface FamilyUsage {
  /** Most recently played first. */
  variants: VariantUsage[];
  /** The equipped deck has the family's cards, whatever their forms. */
  inUse: boolean;
  /** Saved decks with the family's cards, whatever their forms. */
  saved: DeckRecord[];
}

/** Marks a used deck's variants as equipped or saved, for the used-deck dialog. */
export function classifyVariants(
  family: UsedDeckStats,
  saved: DeckRecord[],
  currentDeck: { name: string; evolutionLevel?: number }[] | null,
  catalog: FormCatalog,
): FamilyUsage {
  const familySaved = saved.filter((d) => sameCards(d.cards, family.cards));
  const savedKeys = familySaved.map((d) => [savedDeckVariantKey(d, catalog), d] as const);
  const inUse = Boolean(currentDeck?.length) && sameCards(currentDeck!.map((c) => c.name), family.cards);
  const equippedKey = inUse ? equippedVariantKey(currentDeck!) : null;
  return {
    inUse,
    saved: familySaved,
    variants: variantsByRecency(family).map((variant) => ({
      variant,
      inUse: equippedKey !== null && sameVariant(equippedKey, variant.variantKey),
      savedAs: savedKeys.find(([key]) => sameVariant(key, variant.variantKey))?.[1] ?? null,
    })),
  };
}
