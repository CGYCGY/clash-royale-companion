import { describe, expect, test } from "bun:test";
import type { CardsResponse } from "../../src/cr/types";
import { cardForms, formCount, formsLabel, formsOwnership } from "../../src/domain/evolution";
import { CardIcon } from "../../src/views/components";
import { loadFixture } from "../helpers";

describe("evolution bitmask", () => {
  test("1 is Evo, 2 is Hero, 3 is both", () => {
    expect(cardForms(0)).toEqual({ evo: false, hero: false });
    expect(cardForms(undefined)).toEqual({ evo: false, hero: false });
    expect(cardForms(1)).toEqual({ evo: true, hero: false });
    expect(cardForms(2)).toEqual({ evo: false, hero: true });
    expect(cardForms(3)).toEqual({ evo: true, hero: true });
    expect([0, 1, 2, 3].map(formCount)).toEqual([0, 1, 1, 2]);
    expect([0, 1, 2, 3].map(formsLabel)).toEqual(["", "Evo", "Hero", "Evo + Hero"]);
  });

  test("ownership text lists each available form", () => {
    expect(formsOwnership(0, 0)).toBe("");
    expect(formsOwnership(1, 1)).toBe("Evo");
    expect(formsOwnership(0, 2)).toBe("Hero (not owned)");
    expect(formsOwnership(2, 3)).toBe("Evo (not owned), Hero");
    expect(formsOwnership(3, 3)).toBe("Evo, Hero");
  });

  test("the catalog fixture mirrors the live API: Hero art exactly where bit 2 is set", () => {
    for (const c of loadFixture<CardsResponse>("cards").items) {
      const f = cardForms(c.maxEvolutionLevel);
      expect([c.name, Boolean(c.iconUrls.heroMedium)]).toEqual([c.name, f.hero]);
      expect([c.name, Boolean(c.iconUrls.evolutionMedium)]).toEqual([c.name, f.evo]);
    }
  });
});

describe("CardIcon form badges", () => {
  const card = { name: "Knight", iconUrl: "https://x/k.png", iconUrlEvo: "https://x/k-evo.png", iconUrlHero: "https://x/k-hero.png" };

  test("Evo only", () => {
    const html = String(<CardIcon card={{ ...card, evolutionLevel: 1 }} />);
    expect(html).toContain('class="card-icon size-md evolved"');
    expect(html).toContain('src="https://x/k-evo.png"');
    expect(html).toContain('<span class="card-forms"><span class="card-evo">EVO</span></span>');
  });

  test("Hero only uses the hero art and a HERO badge, not EVO", () => {
    const html = String(<CardIcon card={{ ...card, evolutionLevel: 2 }} />);
    expect(html).toContain('class="card-icon size-md hero"');
    expect(html).toContain('src="https://x/k-hero.png"');
    expect(html).toContain('<span class="card-forms"><span class="card-hero">HERO</span></span>');
    expect(html).not.toContain("EVO");
  });

  test("both forms show both badges", () => {
    const html = String(<CardIcon card={{ ...card, evolutionLevel: 3 }} size="sm" />);
    expect(html).toContain('class="card-icon size-sm evolved hero"');
    expect(html).toContain('<span class="card-evo">EVO</span><span class="card-hero">HERO</span>');
  });

  test("no forms, no badges; missing hero art falls back to the base icon", () => {
    expect(String(<CardIcon card={{ ...card, evolutionLevel: 0 }} />)).not.toContain("card-forms");
    const html = String(<CardIcon card={{ ...card, iconUrlHero: null, evolutionLevel: 2 }} />);
    expect(html).toContain('src="https://x/k.png"');
  });
});
