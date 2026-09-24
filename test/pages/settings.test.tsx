import { beforeEach, describe, expect, test } from "bun:test";
import { createApiKey, listApiKeys } from "../../src/auth/apiKeys";
import { createUser } from "../../src/auth/users";
import { CrApiError } from "../../src/cr/client";
import { getNotes } from "../../src/repos/notes";
import { listPlayersForUser } from "../../src/repos/players";
import type { User } from "../../src/types";
import { FIXTURE_TAG, makeUser } from "../helpers";
import { cookieFor, follow, formPost, type PageTestEnv, setupPages } from "./support";

let env: PageTestEnv;
let user: User;
let cookie: string;
beforeEach(() => {
  env = setupPages();
  user = makeUser();
  cookie = cookieFor(user);
});

describe("settings page", () => {
  test("API keys are rejected on /settings (browser session only)", async () => {
    const { raw } = createApiKey(user.id, "bot");
    const res = await env.app.request("/settings", { headers: { Authorization: `Bearer ${raw}` } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toStartWith("/login");
    const post = await env.app.request("/settings/keys", {
      method: "POST",
      headers: { Authorization: `Bearer ${raw}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "name=sneaky",
    });
    expect(post.status).toBe(302);
    expect(listApiKeys(user.id)).toHaveLength(1);
  });

  test("a non-Bearer Authorization header can't carry a cross-site cookie POST past csrf", async () => {
    for (const [auth, status] of [["Basic dXNlcjpwYXNz", 403], ["Digest x", 403], ["Bearer notakey", 302]] as const) {
      const res = await env.app.request("/settings/keys", {
        method: "POST",
        headers: {
          Authorization: auth,
          Cookie: cookie,
          Origin: "https://evil.example",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "name=stolen",
      });
      // Basic/Digest hit the csrf check; Bearer skips it but then ignores the cookie (login redirect).
      expect(res.status).toBe(status);
      if (status === 302) expect(res.headers.get("location")).toStartWith("/login");
      expect(listApiKeys(user.id)).toHaveLength(0);
    }
    const basicSameOrigin = await env.app.request("/settings/keys", {
      ...formPost(cookie, { name: "behind-proxy" }),
      headers: { ...(formPost(cookie, {}).headers as Record<string, string>), Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(basicSameOrigin.status).toBe(302);
    expect(listApiKeys(user.id).map((k) => k.name)).toEqual(["behind-proxy"]);
  });

  test("creating a key shows the raw key exactly once", async () => {
    const created = await env.app.request("/settings/keys", formPost(cookie, { name: "Claude" }));
    expect(created.status).toBe(302);
    const [key] = listApiKeys(user.id);
    expect(key?.name).toBe("Claude");

    const first = await follow(env.app, created, cookie);
    const html = await first.text();
    const shown = /<input[^>]*id="new-api-key"[^>]*value="(crk_[A-Za-z0-9_-]+)"[^>]*readonly/.exec(html)?.[1];
    expect(html).toContain('aria-label="Copy API key"');
    expect(shown).toBeDefined();
    expect(shown!.startsWith(key!.keyPrefix)).toBe(true);
    expect(html).toContain("http://localhost/api");
    expect(first.headers.getSetCookie().join()).toContain("cr_newkey=;");

    const again = await (await env.app.request("/settings", { headers: { Cookie: cookie } })).text();
    expect(again).not.toContain(shown!);
    expect(again).toContain(key!.keyPrefix);

    const revoked = await env.app.request(`/settings/keys/${key!.id}/revoke`, formPost(cookie, {}));
    expect(revoked.status).toBe(302);
    expect(listApiKeys(user.id)).toHaveLength(0);
    expect((await env.app.request(`/settings/keys/${key!.id}/revoke`, formPost(cookie, {}))).status).toBe(404);
  });

  test("link, annotate, and remove a player", async () => {
    const bad = await env.app.request("/settings/players", formPost(cookie, { tag: "hello!" }));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("look like a player tag");

    const added = await env.app.request("/settings/players", formPost(cookie, { tag: "9qjugc2r" }));
    expect(added.status).toBe(302);
    expect(await (await follow(env.app, added, cookie)).text()).toContain("Added Sparky. Synced 10 battles.");
    expect(listPlayersForUser(user.id).map((p) => p.tag)).toEqual([FIXTURE_TAG]);

    const dup = await env.app.request("/settings/players", formPost(cookie, { tag: FIXTURE_TAG }));
    expect(dup.status).toBe(400);
    expect(await dup.text()).toContain("You already track");

    env.client.fail.getPlayer = new CrApiError(404, "notFound", "Player not found in Clash Royale");
    const missing = await env.app.request("/settings/players", formPost(cookie, { tag: "#2PP" }));
    expect(await missing.text()).toContain("No Clash Royale player has that tag.");

    const notes = await env.app.request("/settings/players/9QJUGC2R/notes", formPost(cookie, { content: "F2P, no pass" }));
    expect(notes.status).toBe(302);
    expect(getNotes(FIXTURE_TAG)?.content).toBe("F2P, no pass");
    const page = await (await env.app.request("/settings", { headers: { Cookie: cookie } })).text();
    expect(page).toContain("F2P, no pass");
    expect(page).toContain("Free text the AI will see");

    const mallory = cookieFor(makeUser("mallory"));
    expect((await env.app.request("/settings/players/9QJUGC2R/remove", formPost(mallory, {}))).status).toBe(404);
    const removed = await env.app.request("/settings/players/9QJUGC2R/remove", formPost(cookie, {}));
    expect(removed.status).toBe(302);
    expect(listPlayersForUser(user.id)).toHaveLength(0);
  });

  test("change password validates and rotates sessions", async () => {
    const real = await createUser("dave", "Old-Password-11");
    const c = cookieFor(real);
    const mismatch = await env.app.request("/settings/password", formPost(c, { current: "Old-Password-11", password: "New-Password-22", confirm: "other-pass" }));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain("New passwords don&#39;t match.");

    const weak = await env.app.request("/settings/password", formPost(c, { current: "Old-Password-11", password: "davedavedave", confirm: "davedavedave" }));
    expect(weak.status).toBe(400);
    const weakHtml = await weak.text();
    expect(weakHtml).toContain("must not contain your username");
    expect(weakHtml).toContain("at least 3 of");

    const wrong = await env.app.request("/settings/password", formPost(c, { current: "nope-nope", password: "New-Password-22", confirm: "New-Password-22" }));
    expect(await wrong.text()).toContain("Current password is wrong.");

    const ok = await env.app.request("/settings/password", formPost(c, { current: "Old-Password-11", password: "New-Password-22", confirm: "New-Password-22" }));
    expect(ok.status).toBe(302);
    expect(ok.headers.getSetCookie().join()).toContain("cr_session=");
    // The old session was revoked.
    expect((await env.app.request("/settings", { headers: { Cookie: c } })).status).toBe(302);
  });
});
