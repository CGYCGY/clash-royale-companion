import { beforeEach, describe, expect, test } from "bun:test";
import type { User } from "../../src/types";
import { makeUser } from "../helpers";
import { cookieFor, linkFixturePlayer, type PageTestEnv, setupPages } from "./support";

let env: PageTestEnv;
let user: User;
let cookie: string;
beforeEach(async () => {
  env = setupPages();
  user = makeUser();
  cookie = cookieFor(user);
});

const get = async (path: string) => (await env.app.request(path, { headers: { Cookie: cookie } })).text();

describe("collection page", () => {
  test("empty state without players", async () => {
    expect(await get("/collection")).toContain("No Players Linked Yet");
  });

  test("Evo and Hero pills show which forms a card has and which are owned", async () => {
    await linkFixturePlayer(user, env.client);
    const html = await get("/collection?q=");
    const card = (name: string) => new RegExp(`<div class="coll-name" title="${name}">.*?</div></div>(?=<div class="coll-card|</div></section>)`).exec(html)?.[0] ?? "";
    const pills = (name: string) => [...card(name).matchAll(/<span class="form-badge ([^"]+)"[^>]*>(\w+)</g)].map((m) => `${m[2]}:${m[1]}`);
    expect(pills("Musketeer")).toEqual(["Evo:form-evo unlocked", "Hero:form-hero unlocked"]);
    expect(pills("Knight")).toEqual(["Evo:form-evo unlocked", "Hero:form-hero"]);
    expect(pills("Ice Golem")).toEqual(["Hero:form-hero unlocked"]);
    expect(pills("Goblins")).toEqual(["Hero:form-hero"]);
    expect(pills("Hog Rider")).toEqual([]);
    expect(html).not.toContain("evo-badge");
  });

  test("renders summary, rarity sections, tower troops, and filters", async () => {
    await linkFixturePlayer(user, env.client);
    const html = await get("/collection");
    expect(html).toContain("Owned");
    expect(html).toContain("Tower Troops");
    expect(html).toMatch(/class="rarity-title">common/);
    expect(html).toContain('class="coll-card');
    expect(html).not.toContain("Elite");
    expect(html).toMatch(/<div class="gold">\d{1,3}(,\d{3})* gold<\/div>/);
    expect(html).toMatch(/<div class="gold">\d{1,3},\d{3}(,\d{3})* gold<\/div>/);

    const searched = await get("/collection?q=hog");
    expect(searched).toContain('title="Hog Rider"');
    // No visible submit button: the filters apply live, with Apply kept for no-JS browsers.
    expect(searched).toContain("<noscript><button type=\"submit\">Apply</button></noscript>");
    expect(searched).not.toMatch(/<button type="submit">Filter</);
    expect(searched).toMatch(/<a id="collection-clear" class="btn btn-ghost" href="\/collection" data-live-clear="true" data-live-swap="true">Clear<\/a>/);
    expect(html).toMatch(/id="collection-clear"[^>]* hidden=""/);
    expect(html).toContain('<form method="get" action="/collection" class="filters" data-live-filter="true">');
    expect(html).toContain('<div id="collection-results" class="stack live-results" data-live-swap="true">');
    expect(searched).not.toContain('title="Knight"');

    const missing = await get("/collection?missing=1");
    expect(missing).not.toMatch(/class="coll-card(?! missing)/);
  });

  // Names in the first card grid (the flat "Cards" section when sorting by anything but rarity).
  const firstGrid = (html: string) => html.split('<div class="coll-grid">')[1]!.split("</section>")[0]!;
  const cardOrder = (html: string) =>
    [...firstGrid(html).matchAll(/<div class="coll-name" title="([^"]+)">/g)].map((m) => m[1]!);
  const levelOf = (html: string, name: string) =>
    Number(new RegExp(`<figure class="card-icon[^"]*" title="${name}">(?:(?!</figure>).)*<span class="card-level">Lv (\\d+)<`).exec(html)?.[1]);

  test("sort by and order, with a flat list and per-sort default order", async () => {
    await linkFixturePlayer(user, env.client);
    const byName = await get("/collection?sort=name");
    expect(byName).toContain('<option value="name" selected="">Name</option>');
    expect(byName).toContain('<h2 class="rarity-title">Cards <span class="muted small">');
    expect(byName).not.toMatch(/class="rarity-title">common/);
    const names = cardOrder(byName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    const desc = cardOrder(await get("/collection?sort=name&order=desc"));
    expect(desc).toEqual([...names].reverse());

    // Level defaults to highest first; the toggle offers the other direction and keeps the other params.
    const byLevel = await get("/collection?sort=level&q=a");
    expect(byLevel).toContain('href="/collection?q=a&amp;sort=level&amp;order=asc" data-order-toggle="true" data-next-order="asc"');
    expect(byLevel).toContain('<input type="hidden" name="order" value=""/>');
    const levels = cardOrder(byLevel)
      .map((n) => levelOf(byLevel, n))
      .filter((l) => !Number.isNaN(l));
    expect(levels.length).toBeGreaterThan(3);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));

    // Rarity desc reverses the section order.
    const rarityDesc = await get("/collection?order=desc");
    expect(rarityDesc.indexOf('rarity-title">champion')).toBeLessThan(rarityDesc.indexOf('rarity-title">common'));

    // Bad values fall back to defaults.
    const bogus = await get("/collection?sort=bogus&order=sideways");
    expect(bogus).toContain('<option value="rarity" selected="">Rarity</option>');
    expect(bogus).toMatch(/class="rarity-title">common/);
  });

  test("upgrade-ready cards show how many levels the held copies cover, their gold, and levels to max", async () => {
    env.client.player = {
      ...env.client.player,
      // Knight is common: API level 11 = display 11. 1,500 + 2,500 copies cover 11→12→13.
      cards: env.client.player.cards.map((c) => (c.name === "Knight" ? { ...c, level: 11, count: 4100, maxLevel: 16 } : c)),
    };
    await linkFixturePlayer(user, env.client);
    const html = await get("/collection");
    const ready = /<h2>Upgrade Ready.*?<\/section>/.exec(html)?.[0] ?? "";
    const knight = /<li class="ready-card">(?:(?!<\/li>).)*?title="Knight">Knight<\/div>(?:(?!<\/li>).)*<\/li>/.exec(ready)?.[0];
    expect(knight).toBeDefined();
    expect(knight).toContain('<div class="ready-levels">Lv 11 → 13 <span class="pos">(+2)</span></div>');
    expect(knight).toContain('<div class="gold">65,000 gold</div>');
    expect(knight).toContain("3 to max");
    // The most levels first.
    expect(ready.indexOf('title="Knight"')).toBeLessThan(ready.indexOf('class="ready-card"', ready.indexOf('title="Knight"')));

    const upgradable = firstGrid(await get("/collection?sort=upgradable"));
    const plus = [...upgradable.matchAll(/<div class="coll-card[^"]*">(?:(?!<div class="coll-card).)*/g)].map(
      (m) => Number(/<div class="upgrade-now pos">\+(\d+) level/.exec(m[0])?.[1] ?? 0),
    );
    expect(plus[0]).toBeGreaterThan(0);
    expect(plus).toEqual([...plus].sort((a, b) => b - a));
  });
  test("Max Out shows cards at the level their copies pay for, with no upgrade-ready leftovers", async () => {
    env.client.player = {
      ...env.client.player,
      cards: env.client.player.cards.map((c) => (c.name === "Knight" ? { ...c, level: 11, count: 4100, maxLevel: 16 } : c)),
    };
    await linkFixturePlayer(user, env.client);
    const off = await get("/collection?sort=level");
    expect(off).toContain('<input type="checkbox" role="switch" name="max" value="1"/>');
    expect(levelOf(off, "Knight")).toBe(11);

    const html = await get("/collection?sort=level&max=1");
    expect(html).toContain('<input type="checkbox" role="switch" name="max" value="1" checked=""/>');
    expect(levelOf(html, "Knight")).toBe(13);
    const knight = /<div class="coll-card[^"]*">(?:(?!<div class="coll-card).)*?title="Knight">Knight<\/div>(?:(?!<div class="coll-card).)*/.exec(html)?.[0] ?? "";
    expect(knight).toContain('<span class="progress-text">100/3500</span>');
    expect(knight).toContain('<div class="muted small">from Lv 11</div>');
    expect(html).not.toContain("<h2>Upgrade Ready");
    expect(html).not.toMatch(/class="coll-card[^"]* ready/);
    expect(html).not.toContain('class="upgrade-now');
    expect(html).toContain('<div id="collection-stats" class="stats" data-live-swap="true">');
    expect(html).not.toMatch(/stat-label">Upgrade Ready/i);
    // The order toggle keeps the switch on.
    expect(html).toContain('href="/collection?max=1&amp;sort=level&amp;order=asc"');

    // Upgrade Ready still filters by the real state, so it lists what the preview raised.
    const raised = await get("/collection?max=1&ready=1");
    expect(raised).toContain('title="Knight"');
    expect(raised).not.toMatch(/class="coll-card[^"]* ready/);
  });
});
