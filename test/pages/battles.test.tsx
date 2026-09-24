import { beforeEach, describe, expect, test } from "bun:test";
import type { BattleLogEntry, GameEvent } from "../../src/cr/types";
import { insertBattles, listBattles } from "../../src/repos/battles";
import { upsertEvents } from "../../src/repos/events";
import { pageList } from "../../src/routes/pages/battles";
import type { User } from "../../src/types";
import { FIXTURE_TAG, loadFixture, makeUser } from "../helpers";
import { cookieFor, linkFixturePlayer, type PageTestEnv, setupPages } from "./support";

let env: PageTestEnv;
let user: User;
let cookie: string;
beforeEach(async () => {
  env = setupPages();
  user = makeUser();
  cookie = cookieFor(user);
  await linkFixturePlayer(user, env.client);
});

const get = async (path: string) => {
  const res = await env.app.request(path, { headers: { Cookie: cookie } });
  return { status: res.status, html: await res.text() };
};

const battleRows = (html: string) => (html.match(/<a href="\/battles\/9QJUGC2R\/\d+" class="row-link"/g) ?? []).length;

describe("battles pages", () => {
  test("lists battles with stats, decks used, and filter options", async () => {
    const { status, html } = await get("/battles");
    expect(status).toBe(200);
    expect(html).toContain("10 Battles");
    expect(battleRows(html)).toBe(10);
    expect(html).toContain("Decks Used");
    expect(html).toContain('<option value="Trophy Road">Trophy Road</option>');
    expect(html).toContain('<option value="Ranked">Ranked</option>');
    expect(html).toContain('<option value="2v2">2v2</option>');
    expect(html).not.toContain("Path of Legend");
    expect(html).not.toContain("Ranked1v1_NewArena2");
    expect(html).toContain("Win Rate");
    expect(html).toContain('<option value="win">Win</option>');
    expect(html).toContain('<option value="loss">Loss</option>');
    expect(html).toContain('<option value="draw">Draw</option>');
  });

  test("stat tiles follow the mode filter but not the result filter", async () => {
    const gamesTile = (html: string) => /<div class="stat-label">Games<\/div><div class="stat-value">(\d+)</.exec(html)?.[1];
    expect(gamesTile((await get("/battles")).html)).toBe("10");
    expect(gamesTile((await get("/battles?mode=Ladder")).html)).toBe("5");
    expect(gamesTile((await get("/battles?mode=Ladder&result=win")).html)).toBe("5");
  });

  test("filters by result, mode, and period", async () => {
    expect(battleRows((await get("/battles?result=draw")).html)).toBe(1);
    const ladder = await get("/battles?mode=Trophy+Road&days=7");
    expect(battleRows(ladder.html)).toBe(5);
    expect(ladder.html).toContain('<option value="Trophy Road" selected="">');
    // Links from before mode labels used raw ids; they select the matching label.
    const old = await get("/battles?mode=Ladder&days=7");
    expect(battleRows(old.html)).toBe(5);
    expect(old.html).toContain('<option value="Trophy Road" selected="">');
    const oldRanked = await get("/battles?mode=pathOfLegend");
    expect(battleRows(oldRanked.html)).toBe(3);
    expect(oldRanked.html).toContain('<option value="Ranked" selected="">');
    // Unknown filter values fall back to defaults instead of erroring.
    expect((await get("/battles?days=bogus&result=nope&page=abc")).status).toBe(200);
  });

  test("detail shows both decks, 2v2 teammates, and raw JSON", async () => {
    const [twoVsTwo] = listBattles(FIXTURE_TAG, { mode: "clanMate2v2" });
    expect(twoVsTwo?.isTwoVsTwo).toBe(true);
    const { status, html } = await get(`/battles/9QJUGC2R/${twoVsTwo!.id}`);
    expect(status).toBe(200);
    expect(html.match(/class="deck-block"/g)?.length).toBe(4);
    expect(html).toContain("Raw Battle Data");
    expect(html).toContain("&quot;battleTime&quot;");
  });

  test("dashboard and battles page share the same battle table", async () => {
    const header = (html: string) => /<thead>(.*?)<\/thead>/.exec(html)?.[1];
    const battlesHtml = (await get("/battles")).html;
    const dashboardHtml = (await get("/")).html;
    expect(header(dashboardHtml)).toBe(header(battlesHtml));
    expect(header(battlesHtml)).toContain("Opponent Deck");
    expect(dashboardHtml).toMatch(/<tr class="battle-row" data-href="\/battles\/9QJUGC2R\/\d+">/);
    expect(dashboardHtml).toContain('<a class="btn btn-secondary btn-small" href="/battles">All Battles</a>');
  });

  test("detail ?partial=1 returns just the detail body for the dialog", async () => {
    const [b] = listBattles(FIXTURE_TAG, { limit: 1 });
    const res = await env.app.request(`/battles/9QJUGC2R/${b!.id}?partial=1`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toStartWith('<div class="stack battle-detail">');
    expect(html).toContain('id="battle-detail-title"');
    expect(html).toContain("Raw Battle Data");
    expect(html).not.toContain("<html");
    expect(html).not.toContain("Back to Battles");

    const full = (await get(`/battles/9QJUGC2R/${b!.id}`)).html;
    expect(full).toContain("<!doctype html>");
    expect(full).toContain('id="battle-detail-title"');
    expect(full).toContain("Back to Battles");
  });

  test("detail partial keeps the page's auth and ownership rules", async () => {
    const [b] = listBattles(FIXTURE_TAG, { limit: 1 });
    const path = `/battles/9QJUGC2R/${b!.id}?partial=1`;
    const anon = await env.app.request(path);
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toStartWith("/login");
    const mallory = cookieFor(makeUser("mallory"));
    expect((await env.app.request(path, { headers: { Cookie: mallory } })).status).toBe(404);
    expect((await get("/battles/9QJUGC2R/999999?partial=1")).status).toBe(404);
  });

  test("detail is 404 for other users and unknown ids", async () => {
    const [b] = listBattles(FIXTURE_TAG, { limit: 1 });
    const mallory = cookieFor(makeUser("mallory"));
    const res = await env.app.request(`/battles/9QJUGC2R/${b!.id}`, { headers: { Cookie: mallory } });
    expect(res.status).toBe(404);
    expect((await get("/battles/9QJUGC2R/999999")).status).toBe(404);
  });

  /** Stores copies of the fixture log shifted back by 1..n hours: 10 more battles per copy. */
  const addOlderCopies = (n: number) => {
    for (let h = 1; h <= n; h++) {
      insertBattles(
        FIXTURE_TAG,
        env.client.battleLog.map((b) => {
          const iso = b.battleTime.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6");
          const shifted = new Date(Date.parse(iso) - h * 3_600_000 - 1000).toISOString();
          return { ...b, battleTime: shifted.replace(/[-:]/g, "") };
        }),
      );
    }
  };
  const pagerLinks = (html: string) => [...(/<nav class="pager".*?<\/nav>/.exec(html)?.[0] ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));

  test("10 battles per page with numbered pager links that keep the filters", async () => {
    expect(pagerLinks((await get("/battles")).html)).toEqual([]);
    addOlderCopies(2);
    const first = (await get("/battles?mode=Ladder&days=7")).html;
    expect(first).toContain("15 Battles");
    expect(battleRows(first)).toBe(10);
    expect(first).toContain('<span class="btn btn-secondary btn-small is-disabled" aria-disabled="true">Prev</span>');
    expect(first).toContain('<span class="btn btn-small pager-current" aria-current="page">1</span>');
    expect(first).toContain("Page 1 of 2");
    expect(pagerLinks(first)).toEqual([
      "/battles?days=7&mode=Trophy+Road&page=2",
      "/battles?days=7&mode=Trophy+Road&page=2",
    ]);

    const second = (await get("/battles?mode=Ladder&days=7&page=2")).html;
    expect(battleRows(second)).toBe(5);
    expect(second).toContain("Page 2 of 2");
    expect(pagerLinks(second)).toEqual(["/battles?days=7&mode=Trophy+Road", "/battles?days=7&mode=Trophy+Road"]);
    expect(second).toContain('aria-disabled="true">Next</span>');

    // Past the end clamps to the last page; the live filter form carries no page, so a filter change restarts at 1.
    const past = (await get("/battles?mode=Ladder&days=7&page=99")).html;
    expect(past).toContain("Page 2 of 2");
    expect(battleRows(past)).toBe(5);
    expect(past).not.toMatch(/<input[^>]*name="page"/);
  });

  test("2026 modes show event titles and mapped labels in the table, filter, and detail", async () => {
    upsertEvents(loadFixture<GameEvent[]>("events"));
    insertBattles(FIXTURE_TAG, loadFixture<BattleLogEntry[]>("battlelog-modes"));
    const { html } = await get("/battles?days=all");
    const options = [...html.matchAll(/<option value="([^"]*)"(?: selected="")?>([^<]*)<\/option>/g)]
      .map((m) => m[2]!)
      .slice(1, -8);
    // Most games first, ties alphabetical.
    expect(options).toEqual([
      "Trophy Road",
      "Clan War",
      "Ranked",
      "2v2",
      "Royale Shuffle",
      "Classic 2v2",
      "Friendly",
      "Princess Gambit Tournament",
    ]);
    expect(html).toContain("<td>Royale Shuffle</td>");
    expect(html).not.toMatch(/<td>[^<]*(RR_|TeamVsTeam|riverRace|boatBattle)/);
    const gambit = await get("/battles?days=all&mode=Princess+Gambit+Tournament");
    expect(battleRows(gambit.html)).toBe(1);
    expect(gambit.html).toContain("<td>Princess Gambit Tournament</td>");

    const shuffle = await get("/battles?days=all&mode=Royale+Shuffle");
    expect(battleRows(shuffle.html)).toBe(2);
    // An old raw link to one Royale Shuffle sub-mode widens to the whole label.
    expect(battleRows((await get("/battles?days=all&mode=RR_Heist_Friendly")).html)).toBe(2);
    // "Classic 2v2" is an event title; the ended event #2C9J990U and the clanMate2v2 friendly fall back to "2v2".
    expect(battleRows((await get("/battles?days=all&mode=2v2")).html)).toBe(2);
    expect(battleRows((await get("/battles?days=all&mode=Classic+2v2")).html)).toBe(1);
    expect(battleRows((await get("/battles?days=all&mode=Clan+War")).html)).toBe(3);

    const [heist] = listBattles(FIXTURE_TAG, { mode: "RR_Heist_Friendly" });
    expect(heist!.modeLabel).toBe("Royale Shuffle");
    const detail = (await get(`/battles/9QJUGC2R/${heist!.id}?partial=1`)).html;
    expect(detail).toContain("<dt>Mode</dt><dd>Royale Shuffle</dd>");
  });

  test("pageList keeps the ends and a window around the current page", () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(1, 3)).toEqual([1, 2, 3]);
    expect(pageList(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageList(10, 10)).toEqual([1, null, 9, 10]);
    expect(pageList(2, 10)).toEqual([1, 2, 3, null, 10]);
    expect(pageList(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageList(4, 10)).toEqual([1, 2, 3, 4, 5, null, 10]);
  });

  test("filters apply live: no Filter button, results in a swappable region", async () => {
    const { html } = await get("/battles");
    expect(html).toContain('<form method="get" action="/battles" class="filters" data-live-filter="true">');
    expect(html).toContain('<noscript><div class="filter-actions"><button type="submit">Apply</button></div></noscript>');
    expect(html).not.toContain(">Filter</button>");
    expect(html).toContain('<div id="battles-results" class="stack live-results" data-live-swap="true">');
  });

  test("Decks Used lists only the 3 most recently played decks", async () => {
    // A third and fourth deck, each played once and more recently than the fixture's two.
    const [newest] = env.client.battleLog;
    const deckOf = (names: string[]) => names.map((name, i) => ({ ...newest!.team[0]!.cards![i]!, name }));
    const later = (minutes: number) =>
      new Date(Date.now() - 3_600_000 + minutes * 60_000).toISOString().replace(/[-:]/g, "");
    insertBattles(FIXTURE_TAG, [
      { ...newest!, battleTime: later(5), team: [{ ...newest!.team[0]!, cards: deckOf(["Knight", "Archers", "Goblins", "Arrows", "Zap", "Minions", "Giant", "Musketeer"]) }] },
      { ...newest!, battleTime: later(10), team: [{ ...newest!.team[0]!, cards: deckOf(["Knight", "Archers", "Goblins", "Arrows", "Zap", "Minions", "Giant", "Valkyrie"]) }] },
    ]);
    const { html } = await get("/battles");
    const section = /<h2>Decks Used.*?<\/section>/.exec(html)?.[0] ?? "";
    expect(section.match(/class="card deck-card"/g)).toHaveLength(3);
    expect(section.indexOf('title="Valkyrie"')).toBeLessThan(section.indexOf('title="Musketeer"'));
  });
});
