import type { SlotForm } from "../repos/decks";
import { cardForms } from "./evolution";

export interface SlotForms {
  /** Forms this slot's card can take here: slots 1–2 only Evo, slot 3 Evo and/or Hero, the rest none. */
  available: SlotForm[];
  /** The form shown, null when none is available. */
  active: SlotForm | null;
}

// In game, slots 1–2 are Evolution slots and slot 3 is a hybrid slot (Evo or Hero); the others show the base card.
const EVO_SLOTS = 2;
const HYBRID_SLOT = 2;

type FormCatalog = Map<string, { maxEvolutionLevel: number | null }>;

export function deckSlotForms(cards: string[], catalog: FormCatalog, slot3Form: SlotForm | null): SlotForms[] {
  return cards.map((name, i) => {
    const can = cardForms(name ? catalog.get(name)?.maxEvolutionLevel : 0);
    const available: SlotForm[] = [];
    if (i < EVO_SLOTS || i === HYBRID_SLOT) {
      if (can.evo) available.push("evo");
      if (i === HYBRID_SLOT && can.hero) available.push("hero");
    }
    const active = available.length > 1 ? (slot3Form ?? "evo") : (available[0] ?? null);
    return { available, active };
  });
}

/** The active form as the evolutionLevel bitmask card views take: Evo 1, Hero 2, none 0. */
export function slotFormsBitmask(f: SlotForms): number {
  return f.active === "evo" ? 1 : f.active === "hero" ? 2 : 0;
}
