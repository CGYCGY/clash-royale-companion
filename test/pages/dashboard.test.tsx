import { beforeEach, describe, expect, test } from "bun:test";
import { config } from "../../src/config";
import { addPlayer } from "../../src/repos/players";
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

describe("dashboard", () => {
  test("renders the fixture snapshot, stats, deck, chests, battles and sync card", async () => {
    await linkFixturePlayer(user, env.client);
    const res = await env.app.request("/", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sparky");
    expect(html).toContain("Royal Hogs");
    expect(html).toContain("Legendary Arena");
    expect(html).toContain("League 7");
    expect(html).toContain("7d win rate");
    expect(html).toContain("30d games");
    expect(html).toContain('title="Hog Rider"');
    // Snapshot levels are API-relative; Hog Rider (rare, API 12) displays as 14.
    // The name fallback is always rendered after the image (CSS hides it; app.js reveals it on load errors).
    expect(html).toMatch(/title="Hog Rider"><img[^>]*\/><span class="card-fallback">Hog Rider<\/span><span class="card-level">Lv 14</);
    expect(html).toContain("Tower Princess");
    expect(html).toContain("Golden Chest");
    expect(html).toContain("/battles/9QJUGC2R/");
    expect(html).toContain("Try again in");
    expect(html).toMatch(/<button type="submit" disabled="" data-retry-after="(29\d|300)" data-ready-label="Sync now">/);
  });

  test("player without a successful sync shows a notice", async () => {
    addPlayer(user.id, "#2PP");
    const html = await (await env.app.request("/", { headers: { Cookie: cookie } })).text();
    expect(html).toContain("hasn&#39;t synced successfully");
    expect(html).toContain("Sync now");
    expect(html).not.toContain("data-retry-after");
  });

  test("switcher picks a player by ?tag and rejects other users' tags", async () => {
    await linkFixturePlayer(user, env.client);
    addPlayer(user.id, "#2PP", "Alt");
    const html = await (await env.app.request("/?tag=2PP", { headers: { Cookie: cookie } })).text();
    expect(html).toContain('class="player-switcher"');
    expect(html).toContain("hasn&#39;t synced successfully");

    addPlayer(makeUser("mallory").id, "#8QQ");
    const other = await env.app.request("/?tag=8QQ", { headers: { Cookie: cookie } });
    expect(other.status).toBe(404);
  });

  test("manual sync: cooldown, success, and ownership", async () => {
    await linkFixturePlayer(user, env.client);
    const cooled = await env.app.request("/players/9QJUGC2R/sync", formPost(cookie, {}));
    expect(cooled.status).toBe(302);
    expect(cooled.headers.get("location")).toBe("/?tag=9QJUGC2R");
    expect(await (await follow(env.app, cooled, cookie)).text()).toMatch(/Try again in \d+s\./);

    config.SYNC_COOLDOWN_SECONDS = 0;
    const synced = await env.app.request("/players/9QJUGC2R/sync", formPost(cookie, {}));
    expect(await (await follow(env.app, synced, cookie)).text()).toContain("Synced, 0 new battles.");

    const mallory = cookieFor(makeUser("mallory"));
    const denied = await env.app.request("/players/9QJUGC2R/sync", formPost(mallory, {}));
    expect(denied.status).toBe(404);
  });
});
