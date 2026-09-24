import { beforeEach, describe, expect, test } from "bun:test";
import { createInvite, getInviteByCode } from "../../src/auth/invites";
import { hashPassword } from "../../src/auth/passwords";
import { createUser, insertUser } from "../../src/auth/users";
import { safeNext } from "../../src/routes/pages/shared";
import { makeUser } from "../helpers";
import { cookieFor, formPost, type PageTestEnv, responseCookies, setupPages } from "./support";

let env: PageTestEnv;
beforeEach(() => {
  env = setupPages();
});

describe("auth pages", () => {
  test("register with invite, then the session cookie opens the dashboard", async () => {
    const invite = createInvite();
    const res = await env.app.request(
      "/register",
      formPost(null, { username: "NewUser", password: "Blue-Otter-4412", confirm: "Blue-Otter-4412", invite: invite.code.toLowerCase() }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings");
    const cookies = responseCookies(res);
    expect(cookies).toContain("cr_session=");

    const settings = await env.app.request("/settings", { headers: { Cookie: cookies } });
    expect(settings.status).toBe(200);
    expect(await settings.text()).toContain("Welcome. Link your player tag to get started.");

    const dash = await env.app.request("/", { headers: { Cookie: cookies } });
    expect(dash.status).toBe(200);
    const html = await dash.text();
    expect(html).toContain("No players linked yet");
    expect(html).toContain("newuser");
  });

  test("register errors re-render the form", async () => {
    const mismatch = await env.app.request(
      "/register",
      formPost(null, { username: "bob", password: "Blue-Otter-4412", confirm: "different1", invite: "X" }),
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain("Passwords don&#39;t match.");

    const badInvite = await env.app.request(
      "/register",
      formPost(null, { username: "bob", password: "Blue-Otter-4412", confirm: "Blue-Otter-4412", invite: "NOPE" }),
    );
    expect(badInvite.status).toBe(400);
    expect(await badInvite.text()).toContain("invite code is invalid");

    makeUser("taken");
    const conflict = await env.app.request(
      "/register",
      formPost(null, { username: "taken", password: "Blue-Otter-4412", confirm: "Blue-Otter-4412", invite: createInvite().code }),
    );
    expect(conflict.status).toBe(400);
    expect(await conflict.text()).toContain("username is taken");

    const badName = await env.app.request(
      "/register",
      formPost(null, { username: "x!", password: "Blue-Otter-4412", confirm: "Blue-Otter-4412", invite: createInvite().code }),
    );
    expect(badName.status).toBe(400);
    expect(await badName.text()).toContain("Username must be");
  });

  test("register rejects a weak password, listing every problem and keeping the other fields", async () => {
    const invite = createInvite();
    const weak = "zedzedzed";
    const res = await env.app.request(
      "/register",
      formPost(null, { username: "zed", password: weak, confirm: weak, invite: invite.code }),
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("at least 12 characters");
    expect(html).toContain("at least 3 of");
    expect(html).toContain("must not contain your username");
    expect(html).toContain('class="error-list"');
    expect(html).toContain('value="zed"');
    expect(html).toContain(`value="${invite.code}"`);
    expect(html).not.toContain(weak);
    expect(getInviteByCode(invite.code)!.uses).toBe(0);

    const common = await env.app.request(
      "/register",
      formPost(null, { username: "zed", password: "Qwerty123456", confirm: "Qwerty123456", invite: invite.code }),
    );
    expect(await common.text()).toContain("too common");
  });

  test("register page renders the rules checklist, eye toggles and policy length hints", async () => {
    const html = await (await env.app.request("/register")).text();
    expect(html).toContain('minlength="12"');
    expect(html).toContain('data-policy="');
    expect(html).toContain("12–128 characters");
    expect(html.match(/class="input-btn password-toggle"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Show password"');
    const login = await (await env.app.request("/login")).text();
    expect(login.match(/class="input-btn password-toggle"/g)).toHaveLength(1);
    expect(login).not.toContain("minlength");
  });

  test("login accepts an existing password that predates the policy", async () => {
    insertUser("oldtimer", await hashPassword("short1"));
    const res = await env.app.request("/login", formPost(null, { username: "oldtimer", password: "short1", next: "/" }));
    expect(res.status).toBe(302);
  });

  test("login redirects to a safe next, rejects bad passwords, logout ends the session", async () => {
    await createUser("carol", "Correct-Horse-7");
    const bad = await env.app.request("/login", formPost(null, { username: "carol", password: "wrong-pass", next: "/" }));
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain("Wrong username or password.");

    const ok = await env.app.request("/login", formPost(null, { username: "Carol", password: "Correct-Horse-7", next: "/decks" }));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/decks");
    const cookie = responseCookies(ok);

    const evil = await env.app.request("/login", formPost(null, { username: "carol", password: "Correct-Horse-7", next: "//evil.com" }));
    expect(evil.headers.get("location")).toBe("/");

    const loginWhileIn = await env.app.request("/login", { headers: { Cookie: cookie } });
    expect(loginWhileIn.status).toBe(302);

    const out = await env.app.request("/logout", formPost(cookie, {}));
    expect(out.headers.get("location")).toBe("/login");
    const after = await env.app.request("/", { headers: { Cookie: cookie } });
    expect(after.status).toBe(302);
  });

  test("login page carries next into the form", async () => {
    const res = await env.app.request("/login?next=%2Fbattles%3Ftag%3DX");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('value="/battles?tag=X"');
  });

  test("safeNext only allows same-origin paths", () => {
    expect(safeNext("/%09/evil.com")).toBe("/%09/evil.com");
    expect(safeNext(decodeURIComponent("/%09/evil.com"))).toBe("/");
    expect(safeNext("/\t/evil.com")).toBe("/");
    expect(safeNext("/\n/evil.com")).toBe("/");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("/ok?tag=x")).toBe("/ok?tag=x");
    expect(safeNext("/battles?tag=X#top")).toBe("/battles?tag=X#top");
  });

  test("login never redirects off-site via a whitespace-smuggled next", async () => {
    await createUser("dave", "Correct-Horse-7");
    const page = await env.app.request("/login?next=/%09/evil.com");
    expect(await page.text()).not.toContain("evil.com");
    const res = await env.app.request("/login", formPost(null, { username: "dave", password: "Correct-Horse-7", next: "/\t/evil.com" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  test("guarded pages redirect to login when unauthenticated", async () => {
    for (const path of ["/", "/battles", "/collection", "/decks", "/decks/new", "/settings", "/battles/9QJUGC2R/1"]) {
      const res = await env.app.request(path);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/login?next=${encodeURIComponent(path)}`);
    }
    const post = await env.app.request("/players/9QJUGC2R/sync", formPost(null, {}));
    expect(post.status).toBe(302);
    expect((await env.app.request("/login")).status).toBe(200);
    expect((await env.app.request("/register")).status).toBe(200);
  });

  test("a logged-in user sees the nav", async () => {
    const res = await env.app.request("/decks", { headers: { Cookie: cookieFor(makeUser()) } });
    const html = await res.text();
    for (const href of ["/", "/battles", "/collection", "/decks", "/settings"]) expect(html).toContain(`href="${href}"`);
  });
});
