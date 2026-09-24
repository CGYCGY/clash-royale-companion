// Since the Heroes update (2025-11-24) the API packs both special forms into evolutionLevel and
// maxEvolutionLevel: bit 1 = Evolution, bit 2 = Hero, so 3 means the card has both. Treating any
// value > 0 as "evolved" counts Heroes as Evos.
const EVO_BIT = 1;
const HERO_BIT = 2;

export interface CardForms {
  evo: boolean;
  hero: boolean;
}

export function cardForms(level: number | null | undefined): CardForms {
  const n = level ?? 0;
  return { evo: (n & EVO_BIT) !== 0, hero: (n & HERO_BIT) !== 0 };
}

/** Each owned form adds 5 to Collection Level. */
export function formCount(level: number | null | undefined): number {
  const f = cardForms(level);
  return Number(f.evo) + Number(f.hero);
}

/** "Evo", "Hero", "Evo + Hero", or "" for none. */
export function formsLabel(level: number | null | undefined): string {
  const f = cardForms(level);
  return [f.evo && "Evo", f.hero && "Hero"].filter(Boolean).join(" + ");
}

/**
 * For the AI context: each form the card can have, marked when the player doesn't own it,
 * e.g. "Evo, Hero (not owned)". Empty when the card has no special forms.
 */
export function formsOwnership(owned: number | null | undefined, available: number | null | undefined): string {
  const have = cardForms(owned);
  const can = cardForms(available);
  const part = (name: string, has: boolean) => (has ? name : `${name} (not owned)`);
  return [can.evo && part("Evo", have.evo), can.hero && part("Hero", have.hero)].filter(Boolean).join(", ");
}
