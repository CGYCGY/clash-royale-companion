import { beforeEach, describe, expect, test } from "bun:test";
import { createDeck } from "../../src/repos/decks";
import { addPlayer } from "../../src/repos/players";
import { syncPlayer } from "../../src/sync";
import type { User } from "../../src/types";
import { FIXTURE_TAG, makeUser } from "../helpers";
import { cookieFor, formPost, linkFixturePlayer, type PageTestEnv, setupPages } from "./support";

const ALT_TAG = "#PYVJ98G2";
const ALT = "PYVJ98G2";

let env: PageTestEnv;
let user: User;
let session: string;
beforeEach(async () => {
  env = setupPages();
  user = makeUser();
  session = cookieFor(user);
  await linkFixturePlayer(user, env.client);
  env.client.player = { ...env.client.player, name: "AltAccount" };
  addPlayer(user.id, ALT_TAG);
  await syncPlayer(ALT_TAG, env.client);
});

const get = (path: string, extraCookie = "") =>
  env.app.request(path, { headers: { Cookie: extraCookie ? `${session}; ${extraCookie}` : session } });

/** The name shown on the header switcher's trigger. */
const currentName = (html: string) => /<span class="player-trigger-name">([^<]*)<\/span>/.exec(html)?.[1];

describe("current player", () => {
  test("defaults to the first linked player and sets no cookie", async () => {
    const res = await get("/");
    expect(currentName(await res.text())).toBe("Sparky");
    expect(res.headers.getSetCookie().join()).not.toContain("cr_player");
  });

  test("the cookie picks the player on every player page", async () => {
    for (const path of ["/", "/battles", "/collection", "/decks"]) {
      const html = await (await get(path, `cr_player=${ALT}`)).text();
      expect(currentName(html)).toBe("AltAccount");
    }
    const battles = await (await get("/battles", `cr_player=${ALT}`)).text();
    expect(battles).toContain(`href="/battles/${ALT}/`);
    expect(battles).not.toContain(`href="/battles/9QJUGC2R/`);
  });

  test("a cookie naming another user's or an unknown tag is ignored and replaced with the first player", async () => {
    addPlayer(makeUser("mallory").id, "#8QQ");
    for (const value of ["8QQ", "garbage", "%23PYVJ98G2"]) {
      const res = await get("/battles", `cr_player=${value}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(currentName(html)).toBe("Sparky");
      expect(html).not.toContain("/battles/8QQ/");
      expect(res.headers.getSetCookie().join()).toContain("cr_player=9QJUGC2R;");
    }
  });

  test("a stale cookie is cleared when the user has no players", async () => {
    const lonely = cookieFor(makeUser("lonely"));
    const res = await env.app.request("/", { headers: { Cookie: `${lonely}; cr_player=${ALT}` } });
    const html = await res.text();
    expect(html).toContain("No Players Linked Yet");
    expect(html).toContain(">Add a Player<");
    expect(res.headers.getSetCookie().join()).toMatch(/cr_player=;.*Max-Age=0/);
  });

  test("?tag= still works on every page, overrides the cookie, and is remembered", async () => {
    for (const path of ["/", "/battles", "/collection", "/decks"]) {
      const res = await get(`${path}?tag=${ALT}`, "cr_player=9QJUGC2R");
      expect(res.status).toBe(200);
      expect(currentName(await res.text())).toBe("AltAccount");
      expect(res.headers.getSetCookie().join()).toContain(`cr_player=${ALT};`);
    }
    // Already current: no redundant Set-Cookie.
    const same = await get(`/battles?tag=${ALT}`, `cr_player=${ALT}`);
    expect(same.headers.getSetCookie().join()).not.toContain("cr_player");
    // Another user's tag is still a 404, and doesn't touch the cookie.
    addPlayer(makeUser("mallory").id, "#8QQ");
    const foreign = await get("/battles?tag=8QQ");
    expect(foreign.status).toBe(404);
    expect(foreign.headers.getSetCookie().join()).not.toContain("cr_player");
  });

  test("the deck level check uses the current player's collection", async () => {
    const deck = createDeck(user.id, {
      name: "Hog",
      cards: ["Hog Rider", "Musketeer", "Valkyrie", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"],
      notes: "",
      source: "manual",
    });
    const header = (html: string) => /<th class="align-right">([^<]*)<\/th>/.exec(html)?.[1];
    expect(header(await (await get(`/decks/${deck.id}`)).text())).toBe("Sparky");
    expect(header(await (await get(`/decks/${deck.id}`, `cr_player=${ALT}`)).text())).toBe("AltAccount");
    expect(header(await (await get(`/decks/${deck.id}/edit`, `cr_player=${ALT}`)).text())).toBe("AltAccount");
  });
});

describe("switch route", () => {
  const post = (fields: Record<string, string>, cookie = session) => env.app.request("/players/current", formPost(cookie, fields));

  test("remembers the player and returns to the same page minus per-player params", async () => {
    const res = await post({ tag: ALT, next: "/battles?tag=9QJUGC2R&mode=Ladder&page=3&days=7" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/battles?mode=Ladder&days=7");
    expect(res.headers.getSetCookie().join()).toContain(`cr_player=${ALT};`);
    expect(res.headers.getSetCookie().join()).toContain("SameSite=Lax");
    expect(res.headers.getSetCookie().join()).toContain("Path=/");

    const detail = await post({ tag: `#${ALT}`, next: "/battles/9QJUGC2R/12" });
    expect(detail.headers.get("location")).toBe("/battles");
    expect((await post({ tag: ALT, next: "/collection?q=hog" })).headers.get("location")).toBe("/collection?q=hog");
  });

  test("only redirects to same-origin paths", async () => {
    for (const next of ["//evil.com", "https://evil.com/", "/\\evil.com", "/\t/evil.com", "javascript:alert(1)", ""]) {
      const res = await post({ tag: ALT, next });
      expect(res.headers.get("location")).toBe("/");
    }
  });

  test("rejects tags the user doesn't own, bad tags, and cross-site posts", async () => {
    addPlayer(makeUser("mallory").id, "#8QQ");
    const foreign = await post({ tag: "8QQ", next: "/" });
    expect(foreign.status).toBe(404);
    expect(foreign.headers.getSetCookie().join()).not.toContain("cr_player");
    expect((await post({ tag: "not a tag!", next: "/" })).status).toBe(400);

    const crossSite = await env.app.request("/players/current", {
      ...formPost(session, { tag: ALT, next: "/" }),
      headers: { ...(formPost(session, {}).headers as Record<string, string>), Origin: "https://evil.example" },
    });
    expect(crossSite.status).toBe(403);

    const anon = await env.app.request("/players/current", formPost(null, { tag: ALT, next: "/" }));
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toStartWith("/login");
  });
});

describe("header", () => {
  test("renders the switcher, settings gear, and POST logout icon button", async () => {
    const html = await (await get("/battles?mode=Ladder")).text();
    expect(html).toContain('<details class="player-menu">');
    expect(html).toContain('<span class="player-trigger-tag">#9QJUGC2R</span>');
    expect(html).toContain('<input type="hidden" name="next" value="/battles?mode=Ladder"/>');
    expect(html).toMatch(/<button type="submit" name="tag" value="9QJUGC2R" class="menu-item" aria-current="true"/);
    expect(html).toMatch(/<button type="submit" name="tag" value="PYVJ98G2" class="menu-item" data-menu-item/);
    expect(html).toContain("Signed in as <strong>alice</strong>");
    expect(html).toContain('href="/settings#players" data-menu-item="link">Manage Players</a>');
    expect(html).toMatch(/<a href="\/settings" class="icon-btn" aria-label="Settings" title="Settings"><svg/);
    expect(html).toMatch(
      /<form method="post" action="\/logout" class="logout-form"><button type="submit" class="icon-btn" aria-label="Log Out" title="Log Out"><svg/,
    );
    // Settings is no longer a text nav link.
    expect(html).not.toMatch(/<nav class="nav"[^]*?>Settings<\/a>[^]*?<\/nav>/);
  });

  test("marks the gear active on settings and sends form re-renders back to their section", async () => {
    const html = await (await get("/settings")).text();
    expect(html).toContain('class="icon-btn active" aria-label="Settings" title="Settings" aria-current="page"');
    const failed = await env.app.request("/settings/keys", formPost(session, { name: "" }));
    expect(failed.status).toBe(400);
    expect(await failed.text()).toContain('<input type="hidden" name="next" value="/settings"/>');
  });

  test("error pages still render the header", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('class="player-menu"');
    expect(html).toContain('<input type="hidden" name="next" value="/"/>');
  });
});
