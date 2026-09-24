import { beforeEach, describe, expect, test } from "bun:test";
import { listBattles } from "../../src/repos/battles";
import type { User } from "../../src/types";
import { FIXTURE_TAG, makeUser } from "../helpers";
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
    expect(html).toContain("10 battles");
    expect(battleRows(html)).toBe(10);
    expect(html).toContain("Decks used");
    expect(html).toContain('<option value="Ladder">Ladder</option>');
    expect(html).toContain("Path of Legend");
    expect(html).toContain("Win rate");
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
    const ladder = await get("/battles?mode=Ladder&days=7");
    expect(battleRows(ladder.html)).toBe(5);
    expect(ladder.html).toContain('<option value="Ladder" selected="">');
    // Unknown filter values fall back to defaults instead of erroring.
    expect((await get("/battles?days=bogus&result=nope&page=abc")).status).toBe(200);
  });

  test("detail shows both decks, 2v2 teammates, and raw JSON", async () => {
    const [twoVsTwo] = listBattles(FIXTURE_TAG, { mode: "clanMate2v2" });
    expect(twoVsTwo?.isTwoVsTwo).toBe(true);
    const { status, html } = await get(`/battles/9QJUGC2R/${twoVsTwo!.id}`);
    expect(status).toBe(200);
    expect(html.match(/class="deck-block"/g)?.length).toBe(4);
    expect(html).toContain("Raw battle data");
    expect(html).toContain("&quot;battleTime&quot;");
  });

  test("dashboard and battles page share the same battle table", async () => {
    const header = (html: string) => /<thead>(.*?)<\/thead>/.exec(html)?.[1];
    const battlesHtml = (await get("/battles")).html;
    const dashboardHtml = (await get("/")).html;
    expect(header(dashboardHtml)).toBe(header(battlesHtml));
    expect(header(battlesHtml)).toContain("Opponent deck");
    expect(dashboardHtml).toMatch(/<tr class="battle-row" data-href="\/battles\/9QJUGC2R\/\d+">/);
    expect(dashboardHtml).toContain('<a class="btn btn-secondary btn-small" href="/battles">All battles</a>');
  });

  test("detail ?partial=1 returns just the detail body for the dialog", async () => {
    const [b] = listBattles(FIXTURE_TAG, { limit: 1 });
    const res = await env.app.request(`/battles/9QJUGC2R/${b!.id}?partial=1`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toStartWith('<div class="stack battle-detail">');
    expect(html).toContain('id="battle-detail-title"');
    expect(html).toContain("Raw battle data");
    expect(html).not.toContain("<html");
    expect(html).not.toContain("Back to battles");

    const full = (await get(`/battles/9QJUGC2R/${b!.id}`)).html;
    expect(full).toContain("<!doctype html>");
    expect(full).toContain('id="battle-detail-title"');
    expect(full).toContain("Back to battles");
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
});
