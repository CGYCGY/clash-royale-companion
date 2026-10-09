import type { SlotForm } from "../repos/decks";
import { cardForms } from "./evolution";

export interface SlotForms {
  /** Forms this slot's card can take here: slot 1 Evo, slot 2 Hero, slot 3 Evo and/or Hero, the rest none. */
  available: SlotForm[];
  /** The form shown, null when none is available. */
  active: SlotForm | null;
}

// Since the March 2026 rework a deck has one Evolution slot (1), one Hero slot (2) and one Wild slot (3) that
// takes either form; the other five show the base card.
const SLOT_FORMS: SlotForm[][] = [["evo"], ["hero"], ["evo", "hero"]];

type FormCatalog = Map<string, { maxEvolutionLevel: number | null }>;

export function deckSlotForms(cards: string[], catalog: FormCatalog, slot3Form: SlotForm | null): SlotForms[] {
  return cards.map((name, i) => {
    const can = cardForms(name ? catalog.get(name)?.maxEvolutionLevel : 0);
    const available = (SLOT_FORMS[i] ?? []).filter((f) => can[f]);
    const active = available.length > 1 ? (slot3Form ?? "evo") : (available[0] ?? null);
    return { available, active };
  });
}

/** The active form as the evolutionLevel bitmask card views take: Evo 1, Hero 2, none 0. */
export function slotFormsBitmask(f: SlotForms): number {
  return f.active === "evo" ? 1 : f.active === "hero" ? 2 : 0;
}
