import { beforeEach, describe, expect, test } from "bun:test";
import { listDecks } from "../../src/repos/decks";
import { deckModeOptions } from "../../src/routes/pages/decks";
import type { User } from "../../src/types";
import { makeUser } from "../helpers";
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
  test("create, view with level check, edit, and delete", async () => {
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
    expect(detail).toContain("Level Check");
    expect(detail).toContain("Sparky");
    expect(detail).toContain("Back to Decks");
    expect(detail).toMatch(/<span class="level-card"><figure class="card-icon size-xs" title="Hog Rider"><img [^>]*alt="Hog Rider"/);

    // The dialog loads just the detail, without the page chrome.
    const partial = await env.app.request(`/decks/${deck!.id}?partial=1`, { headers: { Cookie: cookie } });
    expect(partial.headers.get("cache-control")).toBe("no-store");
    const partialHtml = await partial.text();
    expect(partialHtml).toStartWith('<div class="stack"><section class="card">');
    expect(partialHtml).toContain('<h1 id="deck-detail-title">Hog 2.6</h1>');
    expect(partialHtml).not.toContain("Back to Decks");

    const list = await (await env.app.request("/decks", { headers: { Cookie: cookie } })).text();
    expect(list).toContain("Hog 2.6");
    expect(list).toContain(`<a href="/decks/${deck!.id}" data-modal="Deck">Hog 2.6</a>`);
    expect(list).toContain(`<a class="icon-btn" href="/decks/${deck!.id}/edit" aria-label="Edit Hog 2.6" title="Edit">`);
    expect(list).toContain('class="icon-btn icon-btn-danger" aria-label="Delete Hog 2.6" title="Delete"');

    const edit = await env.app.request(`/decks/${deck!.id}/edit`, { headers: { Cookie: cookie } });
    expect(await edit.text()).toContain('value="Hog Rider"');
    const updated = await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "Hog cycle", cards: HOG, notes: "" }));
    expect(updated.status).toBe(302);
    expect(listDecks(user.id)[0]?.name).toBe("Hog cycle");

    const del = await env.app.request(`/decks/${deck!.id}/delete`, formPost(cookie, {}));
    expect(del.headers.get("location")).toBe("/decks");
    expect(listDecks(user.id)).toHaveLength(0);
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
    expect(nowhere).toContain("No saved deck was played in Touchdown.");
    expect(nowhere).toContain("No other deck was played in Touchdown.");

    const savedOnly = await page("show=saved");
    expect(savedOnly).toContain(">Unplayed</a>");
    expect(savedOnly).not.toContain("<h2>Used in Battles");
    const usedOnly = await page("show=used");
    expect(usedOnly).not.toContain("<h2>Saved Decks</h2>");
    expect(usedOnly).toContain("<h2>Used in Battles");

    expect(await page("")).toContain('<a id="deck-clear" class="btn btn-ghost" href="/decks" data-live-swap="true" hidden="">');
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
});
