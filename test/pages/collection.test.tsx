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
    expect(await get("/collection")).toContain("No players linked yet");
  });

  test("renders summary, rarity sections, tower troops, and filters", async () => {
    await linkFixturePlayer(user, env.client);
    const html = await get("/collection");
    expect(html).toContain("Owned");
    expect(html).toContain("Tower troops");
    expect(html).toMatch(/class="rarity-title">common/);
    expect(html).toContain('class="coll-card');
    expect(html).not.toContain("Elite");
    expect(html).toMatch(/<div class="gold">\d{1,3}(,\d{3})* gold<\/div>/);
    expect(html).toMatch(/<div class="gold">\d{1,3},\d{3}(,\d{3})* gold<\/div>/);

    const searched = await get("/collection?q=hog");
    expect(searched).toContain('title="Hog Rider"');
    expect(searched).toMatch(/<div class="filter-actions"><button type="submit">Filter<\/button><a href="\/collection\?tag=9QJUGC2R">Clear<\/a><\/div>/);
    expect(html).not.toContain(">Clear</a>");
    expect(searched).not.toContain('title="Knight"');

    const missing = await get("/collection?missing=1");
    expect(missing).not.toMatch(/class="coll-card(?! missing)/);
  });
});
