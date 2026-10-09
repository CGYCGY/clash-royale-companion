import { beforeEach, describe, expect, test } from "bun:test";
import type { BattleLogEntry } from "../../src/cr/types";
import { insertBattles } from "../../src/repos/battles";
import { createDeck, listDecks } from "../../src/repos/decks";
import { deckModeOptions, unionTags, withDeckTagOptions } from "../../src/routes/pages/decks";
import type { User } from "../../src/types";
import { FIXTURE_TAG, loadFixture, makeUser } from "../helpers";
import { cookieFor, follow, formPost, linkFixturePlayer, type PageTestEnv, setupPages } from "./support";

let env: PageTestEnv;
let user: User;
let cookie: string;
beforeEach(() => {
  env = setupPages();
  user = makeUser();
  cookie = cookieFor(user);
});

const HOG = ["hog rider", "Musketeer", "Valkyrie", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"];

describe("deck pages", () => {
  test("create, view, edit, and delete", async () => {
    await linkFixturePlayer(user, env.client);
    const created = await env.app.request("/decks", formPost(cookie, { name: "Hog 2.6", cards: HOG, notes: "Cycle fast.\n\n<b>Not bold</b>" }));
    expect(created.status).toBe(302);
    const [deck] = listDecks(user.id);
    expect(deck?.cards[0]).toBe("Hog Rider");
    expect(deck?.source).toBe("manual");
    expect(created.headers.get("location")).toBe(`/decks/${deck!.id}`);

    const detail = await (await follow(env.app, created, cookie)).text();
    expect(detail).toContain('Saved &quot;Hog 2.6&quot;.');
    expect(detail).toContain("<p>Cycle fast.</p>");
    expect(detail).toContain("&lt;b&gt;Not bold&lt;/b&gt;");
    expect(detail).toContain("Back to Decks");
    expect(detail).toMatch(/<div class="deck-slot" data-slot="0"><div class="slot-forms"><\/div><figure class="card-icon size-md" title="Hog Rider"><img [^>]*alt="Hog Rider"/);

    const list = await (await env.app.request("/decks", { headers: { Cookie: cookie } })).text();
    expect(list).toContain("Hog 2.6");
    expect(list).toContain(`<a href="/decks/${deck!.id}" data-modal="Deck">Hog 2.6</a>`);
    expect(list).toContain(`<a class="icon-btn" href="/decks/${deck!.id}?edit=1" data-modal="Deck" aria-label="Edit Hog 2.6" title="Edit">`);
    expect(list).toContain('class="icon-btn icon-btn-danger" aria-label="Delete Hog 2.6" title="Delete"');

    const updated = await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "Hog cycle", cards: HOG, notes: "" }));
    expect(updated.status).toBe(302);
    expect(listDecks(user.id)[0]?.name).toBe("Hog cycle");

    const del = await env.app.request(`/decks/${deck!.id}/delete`, formPost(cookie, {}));
    expect(del.headers.get("location")).toBe("/decks");
    expect(listDecks(user.id)).toHaveLength(0);
  });

  // Slot 1 Zap has only an Evo; slot 3 Musketeer has both forms (maxEvolutionLevel 3).
  const FORMS = ["Zap", "Hog Rider", "Musketeer", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"];
  const get = (path: string) => env.app.request(path, { headers: { Cookie: cookie } });
  const radio = (html: string, value: string) =>
    new RegExp(`<input type="radio" name="slot3Form" value="${value}"([^>/]*)/?>`).exec(html)?.[1] ?? null;

  test("the deck page renders view mode, and edit mode with ?edit=1", async () => {
    await env.app.request("/decks", formPost(cookie, { name: "Forms", cards: FORMS }));
    const [deck] = listDecks(user.id);

    const view = await (await get(`/decks/${deck!.id}`)).text();
    expect(view).toContain(`<form method="post" action="/decks/${deck!.id}" class="stack deck-page" data-deck-page="true" data-mode="view" data-deck-id="${deck!.id}">`);
    expect(view).toContain('<h1 id="deck-detail-title" class="view-only">Forms</h1>');
    expect(view).toContain(`<a class="icon-btn view-only" href="/decks/${deck!.id}?edit=1" data-deck-edit="true" aria-label="Edit deck" title="Edit">`);
    expect(view).toContain('<button type="submit" class="icon-btn edit-only" aria-label="Save deck" title="Save">');
    // Inputs are present for JS to switch to edit, but only edit mode shows them.
    expect(view).toContain('<input type="text" name="cards" class="edit-only" list="card-names" value="Zap"');
    expect(view).toContain('<div class="slot-forms"><span class="form-tag form-evo is-active">Evo</span></div>');
    expect(radio(view, "evo")).toBe(' checked="" disabled=""');
    expect(radio(view, "hero")).toBe(' disabled=""');
    expect(view).toContain('<figure class="card-icon size-md evolved" title="Musketeer">');
    expect(view).not.toContain('class="card-level"');
    expect(view).toContain("Created <time");
    // No linked player: no My Cards switch.
    expect(view).not.toContain("data-level-toggle");
    expect(view).not.toContain("My Cards");

    const edit = await (await get(`/decks/${deck!.id}?edit=1`)).text();
    expect(edit).toContain('data-mode="edit"');
    expect(edit).toContain('value="Hog Rider"');
    expect(radio(edit, "evo")).toBe(' checked=""');
    expect(radio(edit, "hero")).toBe("");
    expect(edit).toContain(`<a class="icon-btn edit-only" href="/decks/${deck!.id}" data-deck-cancel="true" aria-label="Cancel" title="Cancel">`);

    const old = await get(`/decks/${deck!.id}/edit`);
    expect(old.status).toBe(302);
    expect(old.headers.get("location")).toBe(`/decks/${deck!.id}?edit=1`);
  });

  test("new deck page is the same form in edit mode", async () => {
    const html = await (await get("/decks/new")).text();
    expect(html).toContain('<form method="post" action="/decks" class="stack deck-page" data-deck-page="true" data-mode="edit">');
    expect(html).toContain('placeholder="New deck"');
    expect(html).toContain('<a class="icon-btn edit-only" href="/decks" data-deck-cancel="true" aria-label="Cancel" title="Cancel">');
    expect(html).not.toContain("data-deck-edit");
    expect(html).not.toContain("Created <time");
    expect(html.match(/name="cards"/g)).toHaveLength(8);
  });

  test("slot3Form round-trips and drives the slot 3 art", async () => {
    await env.app.request("/decks", formPost(cookie, { name: "Hero", cards: FORMS, slot3Form: "hero" }));
    const [deck] = listDecks(user.id);
    expect(deck?.slot3Form).toBe("hero");
    const html = await (await get(`/decks/${deck!.id}?edit=1`)).text();
    expect(radio(html, "hero")).toBe(' checked=""');
    expect(radio(html, "evo")).toBe("");
    expect(html).toContain('<figure class="card-icon size-md hero" title="Musketeer">');

    await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "Hero", cards: FORMS, slot3Form: "evo" }));
    expect(listDecks(user.id)[0]?.slot3Form).toBe("evo");
    // Absent means no choice, which the evo default then shows.
    await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "Hero", cards: FORMS }));
    expect(listDecks(user.id)[0]?.slot3Form).toBeNull();
  });

  test("partial GET and POST return just the form for the dialog and in-place saves", async () => {
    await env.app.request("/decks", formPost(cookie, { name: "Hog 2.6", cards: HOG }));
    const [deck] = listDecks(user.id);

    const partial = await get(`/decks/${deck!.id}?partial=1`);
    expect(partial.headers.get("cache-control")).toBe("no-store");
    const partialHtml = await partial.text();
    expect(partialHtml).toStartWith("<form ");
    expect(partialHtml).toContain('<h1 id="deck-detail-title" class="view-only">Hog 2.6</h1>');
    expect(partialHtml).not.toContain("Back to Decks");
    expect(partialHtml).not.toContain("<html");
    expect(await (await get(`/decks/${deck!.id}?edit=1&partial=1`)).text()).toContain('data-mode="edit"');

    const saved = await env.app.request(`/decks/${deck!.id}?partial=1`, formPost(cookie, { name: "Hog cycle", cards: HOG }));
    expect(saved.status).toBe(200);
    const savedHtml = await saved.text();
    expect(savedHtml).toStartWith("<form ");
    expect(savedHtml).toContain('data-mode="view"');
    expect(savedHtml).toContain('<h1 id="deck-detail-title" class="view-only">Hog cycle</h1>');
    expect(saved.headers.get("set-cookie") ?? "").not.toContain("flash");
    expect(listDecks(user.id)[0]?.name).toBe("Hog cycle");

    const bad = await env.app.request(`/decks/${deck!.id}?partial=1`, formPost(cookie, { name: "Broken", cards: ["Zap"] }));
    expect(bad.status).toBe(400);
    const badHtml = await bad.text();
    expect(badHtml).toStartWith("<form ");
    expect(badHtml).toContain('data-mode="edit"');
    expect(badHtml).toContain("exactly 8 cards (got 1)");
    expect(badHtml).toContain('value="Broken"');

    const badFull = await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "Broken", cards: ["Zap"] }));
    expect(badFull.status).toBe(400);
    const badFullHtml = await badFull.text();
    expect(badFullHtml).toContain("<html");
    expect(badFullHtml).toContain('data-mode="edit"');
    expect(listDecks(user.id)[0]?.name).toBe("Hog cycle");
  });

  test("the datalist carries the card catalog, plus levels for a linked player", async () => {
    await env.app.request("/decks", formPost(cookie, { name: "Forms", cards: FORMS }));
    const [deck] = listDecks(user.id);
    const option = (html: string, name: string) => new RegExp(`<option value="${name}"[^>]*>`).exec(html)?.[0] ?? "";

    const plain = await (await get(`/decks/${deck!.id}`)).text();
    const musk = option(plain, "Musketeer");
    expect(musk).toContain('data-icon="');
    expect(musk).toContain('data-icon-evo="');
    expect(musk).toContain('data-forms="3"');
    expect(musk).toContain('data-elixir="4"');
    expect(musk).toContain('data-rarity="rare" data-kind="troop"');
    expect(option(plain, "Fireball")).toContain('data-kind="spell"');
    expect(option(plain, "Cannon")).toContain('data-kind="building"');
    expect(musk).not.toContain("data-owned");

    await linkFixturePlayer(user, env.client);
    const linked = await (await get(`/decks/${deck!.id}`)).text();
    expect(linked).toContain('<label class="switch" title="Show your card levels and the forms you own"><input type="checkbox" role="switch" data-level-toggle="true"/>My Cards</label>');
    const hog = option(linked, "Hog Rider");
    expect(hog).toContain('data-owned="1"');
    expect(hog).toMatch(/data-level="\d+" data-max="\d+" data-to="\d+" data-have="0"/);
    expect(option(linked, "Musketeer")).toContain('data-have="3"');
    const mirror = option(linked, "Mirror");
    expect(mirror).toContain('data-owned="0"');
    expect(mirror).not.toContain("data-level=");
    expect(mirror).not.toContain("data-to=");
  });

  test("invalid decks re-render with unknown and duplicate cards listed", async () => {
    const res = await env.app.request(
      "/decks",
      formPost(cookie, { name: "Bad", cards: ["Hog Rider", "Hog Rider", "Not A Card", "Zap", "Arrows", "Miner", "Tesla", "Knight"] }),
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Unknown cards: Not A Card");
    expect(html).toContain("Duplicates: Hog Rider");
    expect(html).toContain('value="Not A Card"');
    expect(listDecks(user.id)).toHaveLength(0);

    const short = await env.app.request("/decks", formPost(cookie, { name: "Short", cards: ["Zap", "", ""] }));
    expect(short.status).toBe(400);
    expect(await short.text()).toContain("exactly 8 cards (got 1)");

    const noName = await env.app.request("/decks", formPost(cookie, { name: " ", cards: HOG }));
    expect(noName.status).toBe(400);
    expect(await noName.text()).toContain("Give the deck a name");
  });

  test("other users' decks are 404", async () => {
    await env.app.request("/decks", formPost(cookie, { name: "Mine", cards: HOG }));
    const [deck] = listDecks(user.id);
    const mallory = cookieFor(makeUser("mallory"));
    expect((await env.app.request(`/decks/${deck!.id}`, { headers: { Cookie: mallory } })).status).toBe(404);
    expect((await env.app.request(`/decks/${deck!.id}/delete`, formPost(mallory, {}))).status).toBe(404);
    expect(listDecks(user.id)).toHaveLength(1);
  });

  test("list shows saved and used decks, tagged, with the equipped one marked in use", async () => {
    await linkFixturePlayer(user, env.client);
    // The fixture player's current deck, which it also played in 8 of the 10 stored battles, in another order.
    const equipped = ["The Log", "Fireball", "Cannon", "Skeletons", "Ice Spirit", "Ice Golem", "Musketeer", "Hog Rider"];
    await env.app.request("/decks", formPost(cookie, { name: "Hog 2.6", cards: equipped }));
    await env.app.request("/decks", formPost(cookie, { name: "Unplayed", cards: HOG }));
    const html = await (await env.app.request("/decks", { headers: { Cookie: cookie } })).text();

    const legend = /<span class="info-tip-text" aria-hidden="true"><ul class="deck-legend">.*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(legend).toContain('<span class="tag tag-saved">Saved</span> saved in this app');
    expect(legend).toContain('<span class="badge badge-source-ai">AI</span> saved by your AI assistant through the API');
    expect(html).toContain('aria-label="In Use: equipped by Sparky now. Saved: saved in this app. AI: saved by your AI assistant through the API. Used: played in Sparky&#39;s stored battles."');
    const saved = /<h2>Saved Decks<\/h2>.*?<\/section>/.exec(html)?.[0] ?? "";
    const used = /<h2>Used in Battles.*?<\/section>/.exec(html)?.[0] ?? "";
    const cards = (section: string) => section.split("<article ").slice(1);

    const [first, second] = cards(saved);
    expect(first).toStartWith('class="card deck-card deck-saved in-use"');
    expect(first).toContain(">Hog 2.6</a>");
    expect(first).toContain('<span class="tag tag-in-use">In Use</span><span class="tag tag-saved">Saved</span>');
    expect(first).toContain("<strong>8</strong> games");
    expect(first).toContain("<strong>63%</strong> win");
    expect(first).toContain(
      '<div class="mode-tags" aria-label="Played in"><span class="tag tag-mode">Trophy Road</span><span class="tag tag-mode">Ranked</span>',
    );
    expect(html).toContain('<label for="mode">Mode</label>');
    expect(second).toStartWith('class="card deck-card deck-saved"');
    expect(second).toContain("no stored battles with this deck");
    expect(second).not.toContain("mode-tags");

    // The matched deck isn't repeated under Used; the fixture's other deck is, as not in use.
    const usedCards = cards(used);
    expect(usedCards).toHaveLength(1);
    expect(usedCards[0]).toStartWith('class="card deck-card deck-used"');
    expect(usedCards[0]).toContain('<span class="tag tag-used">Used</span>');
    expect(usedCards[0]).not.toContain("tag-in-use");
    expect(usedCards[0]).toContain("<strong>2</strong> games");
  });

  test("filters narrow the list by mode played and by saved or used", async () => {
    await linkFixturePlayer(user, env.client);
    const equipped = ["The Log", "Fireball", "Cannon", "Skeletons", "Ice Spirit", "Ice Golem", "Musketeer", "Hog Rider"];
    await env.app.request("/decks", formPost(cookie, { name: "Hog 2.6", cards: equipped }));
    await env.app.request("/decks", formPost(cookie, { name: "Unplayed", cards: HOG }));
    const page = async (q: string) => (await env.app.request(`/decks?${q}`, { headers: { Cookie: cookie } })).text();

    const ranked = await page("mode=Ranked");
    expect(ranked).toContain('<option value="Ranked" selected="">Ranked</option>');
    expect(ranked).toContain(">Hog 2.6</a>");
    expect(ranked).not.toContain(">Unplayed</a>");
    expect(ranked).toContain('<a id="deck-clear" class="btn btn-ghost" href="/decks" data-live-swap="true">');

    const nowhere = await page("mode=Touchdown");
    expect(nowhere).toContain("No saved deck is tagged or was played in Touchdown.");
    expect(nowhere).toContain("No other deck was played in Touchdown.");

    const savedOnly = await page("show=saved");
    expect(savedOnly).toContain(">Unplayed</a>");
    expect(savedOnly).not.toContain("<h2>Used in Battles");
    const usedOnly = await page("show=used");
    expect(usedOnly).not.toContain("<h2>Saved Decks</h2>");
    expect(usedOnly).toContain("<h2>Used in Battles");

    expect(await page("")).toContain('<a id="deck-clear" class="btn btn-ghost" href="/decks" data-live-swap="true" hidden="">');
  });

  const chip = (html: string, value: string) =>
    new RegExp(`<label class="tag-choice"><input type="checkbox" name="tags" value="${value}"([^>/]*)/?>`).exec(html)?.[1] ?? null;

  test("mode tags round-trip through create and edit, from chips and comma-separated text", async () => {
    await env.app.request("/decks", formPost(cookie, { name: "War", cards: HOG, tags: ["Clan War", "triple elixir, Clan war ,", ""] }));
    const [deck] = listDecks(user.id);
    expect(deck?.tags).toEqual(["Clan War", "triple elixir"]);

    const view = await (await get(`/decks/${deck!.id}`)).text();
    expect(view).toContain(
      '<div class="view-only deck-modes"><div class="mode-tags" aria-label="Modes"><span class="tag tag-mode">Clan War</span><span class="tag tag-mode">triple elixir</span></div></div>',
    );
    const edit = await (await get(`/decks/${deck!.id}?edit=1`)).text();
    expect(chip(edit, "Clan War")).toBe(' checked=""');
    expect(chip(edit, "triple elixir")).toBe(' checked=""');
    expect(edit).toContain('<input type="text" name="tags" class="tag-add" maxlength="30" placeholder="Add a mode…"');

    await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "War", cards: HOG, tags: ["Clan War", "Touchdown"] }));
    expect(listDecks(user.id)[0]?.tags).toEqual(["Clan War", "Touchdown"]);

    // The page always submits the whole deck, so no chip checked means no tags, not "keep them".
    await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "War", cards: HOG, tags: "" }));
    expect(listDecks(user.id)[0]?.tags).toEqual([]);
    await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "War", cards: HOG, tags: "Ranked" }));
    await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "War", cards: HOG }));
    expect(listDecks(user.id)[0]?.tags).toEqual([]);
    expect(await (await get(`/decks/${deck!.id}`)).text()).not.toContain("deck-modes\"><div class=\"mode-tags");
  });

  test("a rejected save keeps the submitted tags checked", async () => {
    const res = await env.app.request("/decks", formPost(cookie, { name: "Short", cards: ["Zap"], tags: "Clan War, Duel" }));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(chip(html, "Clan War")).toBe(' checked=""');
    expect(chip(html, "Duel")).toBe(' checked=""');
  });

  test("tag suggestions are the deck's own, then battle-stat modes, then other decks' tags", async () => {
    await linkFixturePlayer(user, env.client);
    await env.app.request("/decks", formPost(cookie, { name: "Other", cards: HOG, tags: "Mega Draft, ranked" }));
    await env.app.request("/decks", formPost(cookie, { name: "Mine", cards: HOG, tags: "Duel" }));
    const mine = listDecks(user.id).find((d) => d.name === "Mine")!;
    const html = await (await get(`/decks/${mine.id}?edit=1`)).text();
    const values = [...html.matchAll(/<label class="tag-choice"><input type="checkbox" name="tags" value="([^"]+)"/g)].map((m) => m[1]);
    expect(values).toEqual(["Duel", "Trophy Road", "Ranked", "2v2", "Friendly", "Mega Draft"]);
    expect(chip(html, "Duel")).toBe(' checked=""');
    expect(chip(html, "Ranked")).toBe("");

    const fresh = await (await get("/decks/new")).text();
    expect(chip(fresh, "Duel")).toBe("");
    expect(chip(fresh, "Mega Draft")).toBe("");
  });

  test("saved deck cards list their own tags before the modes they were played in", async () => {
    await linkFixturePlayer(user, env.client);
    const equipped = ["The Log", "Fireball", "Cannon", "Skeletons", "Ice Spirit", "Ice Golem", "Musketeer", "Hog Rider"];
    await env.app.request("/decks", formPost(cookie, { name: "Hog 2.6", cards: equipped, tags: "Clan War, ranked" }));
    const html = await (await env.app.request("/decks", { headers: { Cookie: cookie } })).text();
    const card = /<article class="card deck-card deck-saved.*?<\/article>/.exec(html)?.[0] ?? "";
    const tags = [...card.matchAll(/<span class="tag tag-mode">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(tags).toEqual(["Clan War", "ranked", "Trophy Road", "2v2", "Friendly"]);
    expect(card).toContain('<div class="mode-tags" aria-label="Modes">');
  });

  test("filtering by a tag no battle has played finds the tagged saved deck", async () => {
    await env.app.request("/decks", formPost(cookie, { name: "War", cards: HOG, tags: "Triple Elixir" }));
    await env.app.request("/decks", formPost(cookie, { name: "Plain", cards: HOG }));
    const page = async (q: string) => (await env.app.request(`/decks?${q}`, { headers: { Cookie: cookie } })).text();

    // No player is linked, so the tag is the only option.
    const all = await page("");
    expect(all).toContain('<option value="Triple Elixir">Triple Elixir</option>');
    const tagged = await page("mode=triple%20elixir");
    expect(tagged).toContain(">War</a>");
    expect(tagged).not.toContain(">Plain</a>");
    expect(await page("mode=Duel")).toContain("No saved deck is tagged or was played in Duel.");
  });

  test("tag options join the battle options, skipping ones already offered", () => {
    const base = [
      { value: "Clan War", text: "Clan War · All" },
      { value: "Touchdown", text: "Clan War · Touchdown" },
    ];
    expect(withDeckTagOptions(base, ["touchdown", "Triple Elixir", "Duel", "duel"])).toEqual([
      ...base,
      { value: "Duel", text: "Duel" },
      { value: "Triple Elixir", text: "Triple Elixir" },
    ]);
    expect(unionTags(["A", "b"], ["B", "c"])).toEqual(["A", "b", "c"]);
  });

  test("mode options offer war sub-modes by tag under their group", () => {
    const row = (modeLabel: string, modeTags: string[]) =>
      ({ type: "", mode: "", modeLabel, modeTags, games: 1, wins: 1, losses: 0, draws: 0, winRate: 1 }) as const;
    expect(
      deckModeOptions([
        row("Trophy Road", ["Trophy Road"]),
        row("Clan War · Battle", ["Clan War", "Battle"]),
        row("Clan War · Touchdown", ["Clan War", "Touchdown"]),
      ]),
    ).toEqual([
      { value: "Trophy Road", text: "Trophy Road" },
      { value: "Clan War", text: "Clan War · All" },
      { value: "Battle", text: "Clan War · Battle" },
      { value: "Touchdown", text: "Clan War · Touchdown" },
    ]);
  });

  test("without a saved match the equipped deck shows in use under Used", async () => {
    await linkFixturePlayer(user, env.client);
    const html = await (await env.app.request("/decks", { headers: { Cookie: cookie } })).text();
    expect(html).toContain("No Saved Decks Yet");
    const used = /<h2>Used in Battles.*?<\/section>/.exec(html)?.[0] ?? "";
    const [first, second] = used.split("<article ").slice(1);
    expect(first).toStartWith('class="card deck-card deck-used in-use"');
    expect(first).toContain("<strong>8</strong> games");
    expect(second).toStartWith('class="card deck-card deck-used"');
  });

  describe("used deck dialog", () => {
    const HOG_KEY = "Cannon|Fireball|Hog Rider|Ice Golem|Ice Spirit|Musketeer|Skeletons|The Log";
    const GOLEM_KEY = "Arrows|Baby Dragon|Bomber|Electro Wizard|Golem|Minions|Poison|Zap";
    const href = (key: string) => `/decks/used?deck=${encodeURIComponent(key)}`;
    const equipped = ["The Log", "Fireball", "Cannon", "Skeletons", "Ice Spirit", "Ice Golem", "Musketeer", "Hog Rider"];

    test("used deck cards open it, saved deck cards open the saved deck", async () => {
      await linkFixturePlayer(user, env.client);
      await env.app.request("/decks", formPost(cookie, { name: "Hog 2.6", cards: equipped }));
      await env.app.request("/decks", formPost(cookie, { name: "Unplayed", cards: HOG }));
      const html = await (await get("/decks")).text();
      const attr = (key: string) => href(key).replaceAll("&", "&amp;");
      const saved = /<h2>Saved Decks<\/h2>.*?<\/section>/.exec(html)?.[0] ?? "";
      const used = /<h2>Used in Battles.*?<\/section>/.exec(html)?.[0] ?? "";
      const [hog, unplayed] = saved.split("<article ").slice(1);
      const [hogDeck, unplayedDeck] = listDecks(user.id).sort((a, b) => a.id - b.id);
      expect(hog).toStartWith(`class="card deck-card deck-saved in-use" data-href="/decks/${hogDeck!.id}" data-modal="Deck">`);
      expect(hog).toContain(`<a href="/decks/${hogDeck!.id}" data-modal="Deck">Hog 2.6</a>`);
      expect(hog).not.toContain("Used Deck");
      expect(unplayed).toStartWith(`class="card deck-card deck-saved" data-href="/decks/${unplayedDeck!.id}" data-modal="Deck">`);
      expect(html).not.toContain(">Details</a>");

      const [golem] = used.split("<article ").slice(1);
      expect(golem).toStartWith(`class="card deck-card deck-used" data-href="${attr(GOLEM_KEY)}" data-modal="Used Deck">`);
      expect(golem).toMatch(new RegExp(`<a href="${RegExp.escape(attr(GOLEM_KEY))}" data-modal="Used Deck" title="[^"]+" data-local-title="[^"]+">played `));
      expect(golem).not.toContain(" forms · ");
    });

    test("saved deck cards put tags and time first, then the name and edit, and delete last", async () => {
      await env.app.request("/decks", formPost(cookie, { name: "Long", cards: HOG, notes: "x".repeat(700) }));
      const html = await (await get("/decks")).text();
      const card = /<article class="card deck-card deck-saved.*?<\/article>/.exec(html)?.[0] ?? "";
      expect(card).toMatch(/<div class="row deck-card-head"><span class="deck-tags">.*?<\/span><div class="spacer"><\/div><span class="muted small">updated /);
      expect(card).toMatch(/<div class="row deck-title"><h3 class="deck-name"><a [^>]+>Long<\/a><\/h3><a class="icon-btn" href="[^"]+\?edit=1"/);
      expect(card).toMatch(/<div class="row deck-actions"><div class="spacer"><\/div><form [^>]*action="\/decks\/\d+\/delete"[^]*<\/form><\/div><\/article>$/);
      expect(card).toContain(`<p class="muted excerpt">${"x".repeat(600)}…</p>`);
    });

    test("partial is the dialog fragment, full page has the back link", async () => {
      await linkFixturePlayer(user, env.client);
      const partial = await get(`${href(HOG_KEY)}&partial=1`);
      expect(partial.status).toBe(200);
      expect(partial.headers.get("cache-control")).toBe("no-store");
      const html = await partial.text();
      expect(html).toStartWith('<div class="stack used-deck">');
      expect(html).toContain('<h1 id="used-deck-title">Used Deck</h1><span class="muted">Sparky</span>');
      expect(html).toContain("<strong>8</strong> games");
      expect(html).toContain('<span class="variant-forms">Last played as ');
      expect(html).toContain("<h2>Forms Played</h2>");
      expect(html).not.toContain("Back to Decks");
      expect(html).not.toContain("<html");

      const full = await (await get(href(HOG_KEY))).text();
      expect(full).toContain("<html");
      expect(full).toContain("Back to Decks");
      expect(full).toContain('<h1 id="used-deck-title">Used Deck</h1>');
    });

    test("the header tags the deck in use and links saved decks with its cards", async () => {
      await linkFixturePlayer(user, env.client);
      await env.app.request("/decks", formPost(cookie, { name: "Hog 2.6", cards: equipped }));
      const [deck] = listDecks(user.id);
      const hog = await (await get(`${href(HOG_KEY)}&partial=1`)).text();
      expect(hog).toContain('<section class="card deck-card deck-used in-use">');
      expect(hog).toContain(
        `<span class="deck-tags"><span class="tag tag-in-use">In Use</span><span class="tag tag-used">Used</span><a class="tag tag-saved tag-link" href="/decks/${deck!.id}" data-modal="Deck">Saved as Hog 2.6</a></span>`,
      );

      // Played in one form only: no variant list.
      const golem = await (await get(`${href(GOLEM_KEY)}&partial=1`)).text();
      expect(golem).toContain('<section class="card deck-card deck-used">');
      expect(golem).not.toContain("tag-in-use");
      expect(golem).not.toContain("Saved as");
      expect(golem).toContain("<strong>2</strong> games");
      expect(golem).toContain('<p class="muted">Played in this form only so far.</p>');
      expect(golem).not.toContain("deck-variant");
    });

    test("unknown deck keys and players without battles are 404", async () => {
      expect((await get(href(HOG_KEY))).status).toBe(404);
      await linkFixturePlayer(user, env.client);
      expect((await get(href("Hog Rider|Zap"))).status).toBe(404);
      expect((await get("/decks/used")).status).toBe(404);
      expect((await get(href(HOG_KEY.toLowerCase()))).status).toBe(404);
    });

    const EVO_KEY = "Cannon|Fireball|Hog Rider|Ice Golem|Ice Spirit:evo|Musketeer:evo|Skeletons|The Log";
    const HERO_KEY = "Cannon|Fireball|Hog Rider|Ice Golem:hero|Ice Spirit:evo|Musketeer:evo+hero|Skeletons|The Log";
    const variantCards = (html: string) => html.split('<article class="card deck-card deck-variant').slice(1);
    // The base log plays the Hog deck in its Evo form only (8 games); the modes fixture adds 7 Evo games and one Hero game.
    const linkWithForms = async () => {
      await linkFixturePlayer(user, env.client);
      insertBattles(FIXTURE_TAG, loadFixture<BattleLogEntry[]>("battlelog-modes"));
    };

    test("a deck played in several forms lists one card per variant, newest first, with its own record", async () => {
      await linkWithForms();
      const html = await (await get(`${href(HOG_KEY)}&partial=1`)).text();
      const [evo, hero, ...rest] = variantCards(html);
      expect(rest).toHaveLength(0);
      expect(evo).toStartWith(`" data-variant-key="${EVO_KEY}">`);
      expect(evo).toContain('<span class="variant-forms">Evo Ice Spirit · Evo Musketeer</span>');
      expect(evo).toContain("<strong>15</strong> games");
      expect(evo).toContain("8W 6L 1D");
      expect(hero).toStartWith(`" data-variant-key="${HERO_KEY}">`);
      expect(hero).toContain('<span class="variant-forms">Evo Ice Spirit · Hero Ice Golem · Evo + Hero Musketeer</span>');
      expect(hero).toContain("<strong>1</strong> game</span>");
      expect(hero).toContain("0W 1L 0D");
      expect(html).not.toContain("Played in this form only so far.");
    });

    test("the header and the list card show the latest variant's forms", async () => {
      await linkWithForms();
      const dialog = await (await get(`${href(HOG_KEY)}&partial=1`)).text();
      const header = dialog.split("<h2>Forms Played</h2>")[0]!;
      expect(header).toContain('<span class="variant-forms">Last played as Evo Ice Spirit · Evo Musketeer</span>');
      expect(header).toMatch(/<figure class="card-icon size-md evolved" title="Musketeer">/);
      expect(header).not.toContain(' hero" title=');

      const list = await (await get("/decks")).text();
      const hog = /<h2>Used in Battles.*?<\/section>/.exec(list)?.[0]?.split("<article ")[1] ?? "";
      expect(hog).toMatch(/<figure class="card-icon size-sm evolved" title="Ice Spirit">/);
      expect(hog).not.toContain('class="card-icon size-sm hero"');
      expect(hog).toContain('<span class="muted small played-link">2 forms · <a href=');
    });

    test("the header grid lays the cards out by slot: Evo, then the empty Hero slot, then the Wild Evo", async () => {
      await linkWithForms();
      const dialog = await (await get(`${href(HOG_KEY)}&partial=1`)).text();
      const header = dialog.split("<h2>Forms Played</h2>")[0]!;
      const titles = [...header.matchAll(/<figure class="card-icon size-md[^"]*" title="([^"]+)">/g)].map((m) => m[1]);
      expect(titles).toEqual(["Ice Spirit", "Cannon", "Musketeer", "Fireball", "Hog Rider", "Ice Golem", "Skeletons", "The Log"]);
    });

    test("a variant card is tagged Saved as when a saved deck's slot forms make it", async () => {
      await linkWithForms();
      // Slot 1 Evo Musketeer, slot 2 Hog Rider (no Hero form), slot 3 Ice Spirit defaults to Evo: the 15-game variant.
      const deck = createDeck(user.id, {
        name: "Hog 2.6 Evo Skellies",
        cards: ["Musketeer", "Hog Rider", "Ice Spirit", "Ice Golem", "Skeletons", "Cannon", "Fireball", "The Log"],
      });
      const html = await (await get(`${href(HOG_KEY)}&partial=1`)).text();
      const [evo, hero] = variantCards(html);
      const savedAs = `<a class="tag tag-saved tag-link" href="/decks/${deck.id}" data-modal="Deck">Saved as Hog 2.6 Evo Skellies</a>`;
      expect(evo).toContain(savedAs);
      expect(hero).not.toContain("Saved as");
      // The equipped deck's slots (Hero Musketeer in slot 2, Hero Ice Golem in slot 3) match no played form.
      expect(html).toContain('<section class="card deck-card deck-used in-use">');
      expect(evo).not.toContain("tag-in-use");
      expect(hero).not.toContain("tag-in-use");
    });

    describe("on the saved deck page", () => {
      const FORMS_PLAYED = '<section class="card view-only"><h2>Forms Played</h2>';
      const savedDeck = (cards: string[]) => createDeck(user.id, { name: "Saved", cards });

      test("lists one card per form the deck's cards were played in, in the page and the partial", async () => {
        await linkWithForms();
        const deck = savedDeck(equipped);
        for (const path of [`/decks/${deck.id}`, `/decks/${deck.id}?partial=1`]) {
          const html = await (await get(path)).text();
          const section = html.split(FORMS_PLAYED)[1] ?? "";
          // After Notes, outside the edit controls.
          expect(html.indexOf(FORMS_PLAYED)).toBeGreaterThan(html.indexOf("<h2>Notes</h2>"));
          const [evo, hero, ...rest] = variantCards(section);
          expect(rest).toHaveLength(0);
          expect(evo).toStartWith(`" data-variant-key="${EVO_KEY}">`);
          expect(evo).toContain("<strong>15</strong> games");
          expect(hero).toStartWith(`" data-variant-key="${HERO_KEY}">`);
        }
      });

      test("a deck played in one form says so", async () => {
        await linkFixturePlayer(user, env.client);
        const deck = savedDeck(GOLEM_KEY.split("|"));
        const html = await (await get(`/decks/${deck.id}?partial=1`)).text();
        expect(html).toContain(`${FORMS_PLAYED}<p class="muted">Played in this form only so far.</p></section>`);
        expect(html).not.toContain("deck-variant");
      });

      test("no section without battles, without a player, or in edit mode", async () => {
        const unlinked = savedDeck(equipped);
        expect(await (await get(`/decks/${unlinked.id}`)).text()).not.toContain("Forms Played");

        await linkWithForms();
        const unplayed = savedDeck(HOG);
        expect(await (await get(`/decks/${unplayed.id}`)).text()).not.toContain("Forms Played");
        expect(await (await get(`/decks/${unlinked.id}?edit=1`)).text()).not.toContain("Forms Played");
        expect(await (await get("/decks/new")).text()).not.toContain("Forms Played");
      });
    });
  });
});
