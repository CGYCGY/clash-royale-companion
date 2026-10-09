import { beforeEach, describe, expect, test } from "bun:test";
import { config } from "../../src/config";
import { getDb } from "../../src/db";
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
  test("renders the fixture snapshot, stats, deck, King Tower card and battles, without a sync card", async () => {
    await linkFixturePlayer(user, env.client);
    const res = await env.app.request("/", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sparky");
    expect(html).toContain("Royal Hogs");
    expect(html).toContain("Legendary Arena");
    expect(html).toContain("League 7");
    expect(html).toContain("7d Win Rate");
    expect(html).toContain("30d Games");
    expect(html).toContain('title="Hog Rider"');
    // Snapshot levels are API-relative; Hog Rider (rare, API 12) displays as 14.
    // The name fallback is always rendered after the image (CSS hides it; app.js reveals it on load errors).
    expect(html).toMatch(/title="Hog Rider"><img[^>]*\/><span class="card-fallback">Hog Rider<\/span><span class="card-level">Lv 14</);
    expect(html).toContain("Tower Princess");
    expect(html).not.toMatch(/chest/i);
    expect(html).toContain("#9QJUGC2R · King Tower 15</div>");
    expect(html).not.toContain("King level");
    expect(html).toMatch(/<h2>King Tower &amp; Collection Level<\/h2><span class="info-tip info-tip-end"><button type="button" class="info-tip-btn" aria-label="Collection Level adds up/);
    expect(html).toContain('<div class="stat-label">Collection Level</div><div class="stat-value">546</div>');
    // KT15 → 16 needs 14 cards at level 15+ (tower troops excluded); the fixture has 3.
    expect(html).toContain("Next: King Tower 16 needs 14 cards at level 15+");
    expect(html).toContain('<span class="progress-text">3/14</span>');
    expect(html).toContain("plus 5 per Evolution and Hero owned");
    expect(html).toContain("/battles/9QJUGC2R/");
    expect(html).not.toContain("<h2>Sync</h2>");
    expect(html).not.toContain("Last synced:");
  });

  test("current deck marks Evo, Hero, and Evo + Hero cards", async () => {
    await linkFixturePlayer(user, env.client);
    const html = await (await env.app.request("/", { headers: { Cookie: cookie } })).text();
    const icon = (name: string) => new RegExp(`<figure class="([^"]*)" title="${name}"><img src="([^"]*)"[^>]*/>.*?</figure>`).exec(html);
    const musketeer = icon("Musketeer")!;
    expect(musketeer[1]).toBe("card-icon size-md evolved hero");
    expect(musketeer[0]).toContain('<span class="card-forms"><span class="card-evo">EVO</span><span class="card-hero">HERO</span></span>');
    const golem = icon("Ice Golem")!;
    expect(golem[1]).toBe("card-icon size-md hero");
    expect(golem[2]).toContain("/cardheroes/");
    expect(golem[0]).toContain('<span class="card-forms"><span class="card-hero">HERO</span></span>');
    const spirit = icon("Ice Spirit")!;
    expect(spirit[1]).toBe("card-icon size-md evolved");
    expect(spirit[0]).not.toContain("HERO");
    expect(icon("Hog Rider")![0]).not.toContain("card-forms");
  });

  test("King Tower card falls back to a dash for snapshots from before the fields existed", async () => {
    const { kingTowerLevel: _kt, collectionLevel: _cl, ...old } = env.client.player;
    env.client.player = old as typeof env.client.player;
    await linkFixturePlayer(user, env.client);
    const html = await (await env.app.request("/", { headers: { Cookie: cookie } })).text();
    expect(html).toContain("#9QJUGC2R · King Tower —</div>");
    expect(html).toContain('<div class="stat-label">King Tower</div><div class="stat-value">—</div>');
    expect(html).toContain('<div class="stat-label">Collection Level</div><div class="stat-value">—</div>');
    expect(html).toContain("Not in this snapshot yet");
    expect(html).not.toContain("Next: King Tower");
    // The frozen expLevel must not leak back in as a stand-in.
    expect(html).not.toContain(`King Tower ${old.expLevel}`);
  });

  test("gold and gems: saved from the header form, separators accepted, blank clears", async () => {
    await linkFixturePlayer(user, env.client);
    const before = await (await env.app.request("/", { headers: { Cookie: cookie } })).text();
    expect(before).toContain('<form method="post" action="/players/9QJUGC2R/resources" class="facts resources-form" data-save-on-change="true">');
    expect(before).toContain("The Clash Royale API doesn&#39;t share your gems, so enter it here.\"");

    const res = await env.app.request("/players/9QJUGC2R/resources", formPost(cookie, { gold: "1,234,567", gems: " 890 " }));
    expect(res.status).toBe(302);
    const html = await (await follow(env.app, res, cookie)).text();
    expect(html).toContain("Saved gold and gems.");
    expect(html).toContain('id="res-gold" type="text" name="gold" inputmode="numeric" autocomplete="off" placeholder="—" value="1,234,567"');
    expect(html).toContain('name="gems" inputmode="numeric" autocomplete="off" placeholder="—" value="890"');
    expect(html).toContain("so enter it here. Last saved just now.");
    expect(getDb().query("SELECT gold, gems FROM player_resources").get()).toEqual({ gold: 1_234_567, gems: 890 });

    await env.app.request("/players/9QJUGC2R/resources", formPost(cookie, { gold: "", gems: "5" }));
    expect(getDb().query("SELECT gold, gems FROM player_resources").get()).toEqual({ gold: null, gems: 5 });
  });

  test("gold and gems: bad input flashes an error and keeps the old values; other users' tags 404", async () => {
    await linkFixturePlayer(user, env.client);
    await env.app.request("/players/9QJUGC2R/resources", formPost(cookie, { gold: "100", gems: "5" }));
    for (const gold of ["-1", "1.5k", "1000000000"]) {
      const res = await env.app.request("/players/9QJUGC2R/resources", formPost(cookie, { gold, gems: "5" }));
      expect(await (await follow(env.app, res, cookie)).text()).toContain("Gold and gems must be whole numbers");
    }
    expect(getDb().query("SELECT gold, gems FROM player_resources").get()).toEqual({ gold: 100, gems: 5 });

    addPlayer(makeUser("mallory").id, "#8QQ");
    const other = await env.app.request("/players/8QQ/resources", formPost(cookie, { gold: "1", gems: "1" }));
    expect(other.status).toBe(404);
  });

  test("King Tower card says max at level 16", async () => {
    env.client.player = { ...env.client.player, kingTowerLevel: 16 };
    await linkFixturePlayer(user, env.client);
    const html = await (await env.app.request("/", { headers: { Cookie: cookie } })).text();
    expect(html).toContain("Max King Tower level.");
    expect(html).not.toContain("Next: King Tower");
  });

  test("the snapshot header shows the last confirming sync, not when the state first appeared", async () => {
    await linkFixturePlayer(user, env.client);
    getDb().query("UPDATE player_snapshots SET fetched_at = ?, last_seen_at = ?").run("2026-01-01T00:00:00.000Z", new Date().toISOString());
    const html = await (await env.app.request("/", { headers: { Cookie: cookie } })).text();
    expect(html).toContain("Snapshot just now");
  });

  test("player without a successful sync shows a notice", async () => {
    addPlayer(user.id, "#2PP");
    const html = await (await env.app.request("/", { headers: { Cookie: cookie } })).text();
    expect(html).toContain("hasn&#39;t synced successfully");
  });

  test("switcher picks a player by ?tag and rejects other users' tags", async () => {
    await linkFixturePlayer(user, env.client);
    addPlayer(user.id, "#2PP", "Alt");
    const res = await env.app.request("/?tag=2PP", { headers: { Cookie: cookie } });
    expect(res.headers.getSetCookie().join()).toContain("cr_player=2PP;");
    const html = await res.text();
    expect(html).toContain('class="player-menu"');
    expect(html).toContain("hasn&#39;t synced successfully");

    addPlayer(makeUser("mallory").id, "#8QQ");
    const other = await env.app.request("/?tag=8QQ", { headers: { Cookie: cookie } });
    expect(other.status).toBe(404);
  });

  test("header sync button: cooldown state, last sync time, and hidden without players", async () => {
    const noPlayers = await (await env.app.request("/battles", { headers: { Cookie: cookie } })).text();
    expect(noPlayers).not.toContain("sync-btn");

    await linkFixturePlayer(user, env.client);
    const html = await (await env.app.request("/battles?mode=Ladder", { headers: { Cookie: cookie } })).text();
    const form = /<form method="post" action="\/players\/9QJUGC2R\/sync" class="sync-form">.*?<\/form>/.exec(html)?.[0];
    expect(form).toBeDefined();
    expect(form).toContain('<input type="hidden" name="next" value="/battles?mode=Ladder"/>');
    // Just synced, so the 300s cooldown is running.
    expect(form).toMatch(/aria-label="Sync available in (29\d|300)s"[^>]* disabled="" data-retry-after="(29\d|300)" data-ready-label="Sync Now"/);
    expect(form).toContain('class="icon-refresh"');
    expect(form).toMatch(/<time id="sync-time" class="sync-time" datetime="[^"]+" title="Last synced [^"]+ UTC" data-local-title="[^"]+">just now<\/time>/);
    // The sync control sits left of the player switcher.
    expect(html.indexOf('class="sync-form"')).toBeLessThan(html.indexOf('class="player-menu"'));

    config.SYNC_COOLDOWN_SECONDS = 0;
    const ready = await (await env.app.request("/", { headers: { Cookie: cookie } })).text();
    expect(ready).toMatch(/class="icon-btn sync-btn" aria-label="Sync Now" title="Sync Now"/);
    expect(ready).not.toContain("data-retry-after");
  });

  test("header sync time says never for a player that hasn't synced", async () => {
    addPlayer(user.id, "#2PP");
    const html = await (await env.app.request("/", { headers: { Cookie: cookie } })).text();
    expect(html).toContain('<span id="sync-time" class="sync-time" title="Never synced">never</span>');
    expect(html).toContain('aria-label="Sync Now"');
  });

  test("manual sync returns to the page it was started from", async () => {
    await linkFixturePlayer(user, env.client);
    config.SYNC_COOLDOWN_SECONDS = 0;
    const res = await env.app.request("/players/9QJUGC2R/sync", formPost(cookie, { next: "/battles?mode=Ladder" }));
    expect(res.headers.get("location")).toBe("/battles?mode=Ladder");
    const offsite = await env.app.request("/players/9QJUGC2R/sync", formPost(cookie, { next: "//evil.example" }));
    expect(offsite.headers.get("location")).toBe("/");
  });

  test("manual sync: cooldown, success, and ownership", async () => {
    await linkFixturePlayer(user, env.client);
    const cooled = await env.app.request("/players/9QJUGC2R/sync", formPost(cookie, {}));
    expect(cooled.status).toBe(302);
    expect(cooled.headers.get("location")).toBe("/");
    expect(cooled.headers.getSetCookie().join()).toContain("cr_player=9QJUGC2R;");
    expect(await (await follow(env.app, cooled, cookie)).text()).toMatch(/Try again in \d+s\./);

    config.SYNC_COOLDOWN_SECONDS = 0;
    const synced = await env.app.request("/players/9QJUGC2R/sync", formPost(cookie, {}));
    expect(await (await follow(env.app, synced, cookie)).text()).toContain("Synced, 0 new battles.");

    const mallory = cookieFor(makeUser("mallory"));
    const denied = await env.app.request("/players/9QJUGC2R/sync", formPost(mallory, {}));
    expect(denied.status).toBe(404);
  });
});
