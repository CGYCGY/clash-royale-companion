import { beforeEach, describe, expect, test } from "bun:test";
import { createApiKey, listApiKeys } from "../../src/auth/apiKeys";
import { createUser, getUserById } from "../../src/auth/users";
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
    expect(html).toContain('aria-label="Copy API Key"');
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

  test("Change Password is collapsed until opened, and re-renders open with its errors", async () => {
    const html = await (await env.app.request("/settings", { headers: { Cookie: cookie } })).text();
    expect(html).toMatch(/<details class="disclosure"><summary class="btn btn-secondary">Change Password<svg/);
    expect(html).toContain('<form method="post" action="/settings/password" class="form-narrow disclosure-body">');

    const failed = await env.app.request("/settings/password", formPost(cookie, { current: "x", password: "a", confirm: "b" }));
    expect(failed.status).toBe(400);
    const failedHtml = await failed.text();
    expect(failedHtml).toContain('<details class="disclosure" open="">');
    expect(failedHtml).toContain("New passwords don&#39;t match.");

    // Another section's error leaves it collapsed.
    const keyError = await (await env.app.request("/settings/keys", formPost(cookie, { name: "" }))).text();
    expect(keyError).toContain('<details class="disclosure">');
  });

  test("password fields ship one visible eye icon; the eye-off one starts hidden", async () => {
    const html = await (await env.app.request("/settings", { headers: { Cookie: cookie } })).text();
    expect(html).toMatch(
      /<button type="button" class="input-btn password-toggle" aria-label="Show Password" title="Show Password" aria-pressed="false" aria-controls="current" hidden=""><span class="icon-slot" data-show-icon="true"><svg[^>]*class="icon-eye"[^]*?<\/span><span class="icon-slot" data-hide-icon="true" hidden=""><svg[^>]*class="icon-eye-off"/,
    );
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

  test("change username: success keeps sessions and API keys working", async () => {
    const real = await createUser("erin", "Old-Password-11");
    const c = cookieFor(real);
    const { raw } = createApiKey(real.id, "bot");
    const ok = await env.app.request("/settings/username", formPost(c, { username: " Erin_2 ", current: "Old-Password-11" }));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/settings#username");
    expect(getUserById(real.id)?.username).toBe("erin_2");

    const page = await (await follow(env.app, ok, c)).text();
    expect(page).toContain('<p class="inline-status pos" role="status">Username changed to erin_2.</p>');
    // Shown beside the form, not also as the page-top flash.
    expect(page).not.toContain('class="flash flash-success"');
    expect(page).toContain('title="Signed in as erin_2"');

    const me = await env.app.request("/api/me", { headers: { Authorization: `Bearer ${raw}` } });
    expect(((await me.json()) as { user: { username: string } }).user.username).toBe("erin_2");
    const login = await env.app.request("/login", formPost(null, { username: "erin_2", password: "Old-Password-11", next: "/" }));
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe("/");
  });

  test("change username: taken, wrong password, and invalid names re-render inline", async () => {
    const real = await createUser("frank", "Old-Password-11");
    makeUser("taken_name");
    const c = cookieFor(real);
    const attempt = async (username: string, current = "Old-Password-11") => {
      const res = await env.app.request("/settings/username", formPost(c, { username, current }));
      expect(res.status).toBe(400);
      return res.text();
    };
    const taken = await attempt("TAKEN_NAME");
    expect(taken).toContain("That username is taken. Pick another one.");
    expect(taken).toContain('value="TAKEN_NAME"');
    expect(await attempt("new_frank", "wrong-password")).toContain("Current password is wrong.");
    expect(await attempt("x!")).toContain("Username must be 3–32 characters");
    expect(await attempt("ab")).toContain("Username must be 3–32 characters");
    expect(getUserById(real.id)?.username).toBe("frank");

    // Renaming to your own name (any case) is not a conflict.
    const same = await env.app.request("/settings/username", formPost(c, { username: "FRANK", current: "Old-Password-11" }));
    expect(same.status).toBe(302);
  });

  test("change username needs a browser session", async () => {
    const { raw } = createApiKey(user.id, "bot");
    const res = await env.app.request("/settings/username", {
      method: "POST",
      headers: { Authorization: `Bearer ${raw}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=hijack&current=x",
    });
    expect(res.status).toBe(302);
    expect(getUserById(user.id)?.username).toBe("alice");
  });
});
