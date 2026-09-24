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

const battleRows = (html: string) => (html.match(/href="\/battles\/9QJUGC2R\/\d+"/g) ?? []).length;

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

  test("detail is 404 for other users and unknown ids", async () => {
    const [b] = listBattles(FIXTURE_TAG, { limit: 1 });
    const mallory = cookieFor(makeUser("mallory"));
    const res = await env.app.request(`/battles/9QJUGC2R/${b!.id}`, { headers: { Cookie: mallory } });
    expect(res.status).toBe(404);
    expect((await get("/battles/9QJUGC2R/999999")).status).toBe(404);
  });
});
