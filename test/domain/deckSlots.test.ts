import { beforeEach, describe, expect, test } from "bun:test";
import { deckSlotForms, slotFormsBitmask } from "../../src/domain/deckSlots";
import { cardsMap } from "../../src/repos/cards";
import { makeTestDb, seedCards } from "../helpers";

beforeEach(() => {
  makeTestDb();
  seedCards();
});

// Fixture forms: Knight Evo + Hero, Giant Hero only, Archers Evo only, Hog Rider none.
describe("deckSlotForms", () => {
  test("slot 3 with both forms defaults to Evo and follows the chosen form", () => {
    const cards = ["Hog Rider", "Archers", "Knight"];
    expect(deckSlotForms(cards, cardsMap(), null)[2]).toEqual({ available: ["evo", "hero"], active: "evo" });
    expect(deckSlotForms(cards, cardsMap(), "hero")[2]).toEqual({ available: ["evo", "hero"], active: "hero" });
  });

  test("slot 3 with a single form uses it whatever was chosen", () => {
    expect(deckSlotForms(["Hog Rider", "Archers", "Giant"], cardsMap(), "evo")[2]).toEqual({
      available: ["hero"],
      active: "hero",
    });
    expect(deckSlotForms(["Hog Rider", "Giant", "Archers"], cardsMap(), "hero")[2]).toEqual({
      available: ["evo"],
      active: "evo",
    });
  });

  test("slot 1 only offers Evo, slot 2 only Hero, slots 4+ nothing, and short or blank lists work", () => {
    const forms = deckSlotForms(["Knight", "Knight", "", "Knight"], cardsMap(), "hero");
    expect(forms).toEqual([
      { available: ["evo"], active: "evo" },
      { available: ["hero"], active: "hero" },
      { available: [], active: null },
      { available: [], active: null },
    ]);
    expect(deckSlotForms(["Giant", "Archers"], cardsMap(), null)).toEqual([
      { available: [], active: null },
      { available: [], active: null },
    ]);
    expect(deckSlotForms([], cardsMap(), null)).toEqual([]);
  });

  test("bitmask matches the evolutionLevel encoding", () => {
    const [evo, none, hero] = deckSlotForms(["Knight", "Hog Rider", "Knight"], cardsMap(), "hero");
    expect([evo!, none!, hero!].map(slotFormsBitmask)).toEqual([1, 0, 2]);
  });
});
