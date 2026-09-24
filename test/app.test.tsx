import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createApp } from "../src/app";
import { createAdminToken } from "../src/auth/adminTokens";
import { createApiKey } from "../src/auth/apiKeys";
import { currentUser, requireAdmin, requireSession, requireUser } from "../src/auth/middleware";
import { createSession, SESSION_COOKIE } from "../src/auth/sessions";
import { AppError } from "../src/errors";
import { setFlash } from "../src/http/flash";
import type { AppEnv, User } from "../src/types";
import { renderPage } from "../src/views/render";
import { makeTestDb, makeUser } from "./helpers";

let app: Hono<AppEnv>;
let user: User;

beforeEach(() => {
  makeTestDb();
  user = makeUser();
  app = createApp();
  // Routes added after createApp still get the global middleware and handlers.
  app.get("/api/test/whoami", requireUser, (c) => c.json({ user: currentUser(c), via: c.var.authMethod }));
  app.post("/api/test/session-only", requireSession, (c) => c.json({ ok: true }));
  app.post("/api/admin/ping", requireAdmin, (c) => c.json({ ok: true }));
  app.get("/api/boom", () => {
    throw new AppError("invalid_deck", "bad deck", 400, { unknown: ["X"] });
  });
  app.get("/api/crash", () => {
    throw new Error("secret internals");
  });
  app.get("/dashboard", requireUser, (c) => renderPage(c, { title: "Dash", active: "dashboard" }, <h1>Hello</h1>));
  app.post("/form", requireUser, (c) => {
    setFlash(c, "success", "Saved!");
    return c.redirect("/dashboard");
  });
});

const cookieFor = (u: User) => `${SESSION_COOKIE}=${createSession(u.id)}`;

describe("app basics", () => {
  test("health", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, dbOk: true, version: expect.any(String) });
  });

  test("404 is JSON under /api and HTML elsewhere", async () => {
    const api = await app.request("/api/nope");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: { code: "not_found", message: "No route for GET /api/nope" } });
    const page = await app.request("/nope");
    expect(page.status).toBe(404);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("<!doctype html>");
  });

  test("AppError and unexpected errors are shaped", async () => {
    const res = await app.request("/api/boom");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_deck", message: "bad deck", details: { unknown: ["X"] } } });
    const origError = console.error;
    console.error = () => {};
    const crash = await app.request("/api/crash");
    console.error = origError;
    expect(crash.status).toBe(500);
    const body = (await crash.json()) as { error: { code: string } };
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("secret internals");
  });

  test("static files are served", async () => {
    const res = await app.request("/static/app.css");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("--bg");
  });
});

describe("authentication", () => {
  test("unauthenticated API gets 401 JSON; pages redirect to login", async () => {
    const api = await app.request("/api/test/whoami");
    expect(api.status).toBe(401);
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
    const page = await app.request("/dashboard?x=1");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login?next=%2Fdashboard%3Fx%3D1");
  });

  test("session cookie and API key both authenticate", async () => {
    const viaCookie = await app.request("/api/test/whoami", { headers: { Cookie: cookieFor(user) } });
    expect(await viaCookie.json()).toMatchObject({ user: { id: user.id }, via: "session" });
    const { raw } = createApiKey(user.id, "test");
    const viaKey = await app.request("/api/test/whoami", { headers: { Authorization: `Bearer ${raw}` } });
    expect(await viaKey.json()).toMatchObject({ user: { id: user.id }, via: "apikey" });
  });

  test("an invalid API key does not fall back to the cookie", async () => {
    const res = await app.request("/api/test/whoami", {
      headers: { Authorization: "Bearer crk_bogus", Cookie: cookieFor(user) },
    });
    expect(res.status).toBe(401);
  });

  test("requireSession rejects API keys", async () => {
    const { raw } = createApiKey(user.id, "test");
    const res = await app.request("/api/test/session-only", { method: "POST", headers: { Authorization: `Bearer ${raw}` } });
    expect(res.status).toBe(403);
    const ok = await app.request("/api/test/session-only", {
      method: "POST",
      headers: { Cookie: cookieFor(user), "Content-Type": "application/json" },
      body: "{}",
    });
    expect(ok.status).toBe(200);
  });

  test("requireAdmin checks the admin token", async () => {
    const bad = await app.request("/api/admin/ping", { method: "POST", headers: { Authorization: "Bearer nope" } });
    expect(bad.status).toBe(401);
    const good = await app.request("/api/admin/ping", {
      method: "POST",
      headers: { Authorization: `Bearer ${createAdminToken("test").raw}` },
    });
    expect(good.status).toBe(200);
  });
});

describe("csrf and pages", () => {
  const form = { "Content-Type": "application/x-www-form-urlencoded" };

  test("cross-site form posts are rejected; same-origin pass", async () => {
    const cross = await app.request("/form", {
      method: "POST",
      headers: { ...form, Cookie: cookieFor(user), Origin: "https://evil.example" },
      body: "a=1",
    });
    expect(cross.status).toBe(403);
    const same = await app.request("/form", {
      method: "POST",
      headers: { ...form, Cookie: cookieFor(user), Origin: "http://localhost" },
      body: "a=1",
    });
    expect(same.status).toBe(302);
  });

  test("bodyless API-key POSTs are not blocked by csrf", async () => {
    const res = await app.request("/api/admin/ping", {
      method: "POST",
      headers: { Authorization: `Bearer ${createAdminToken("test").raw}` },
    });
    expect(res.status).toBe(200);
  });

  test("layout renders nav and the flash message once", async () => {
    const cookie = cookieFor(user);
    const post = await app.request("/form", {
      method: "POST",
      headers: { ...form, Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
      body: "a=1",
    });
    const flashCookie = post.headers.get("set-cookie")!.split(";")[0]!;
    const page = await app.request("/dashboard", { headers: { Cookie: `${cookie}; ${flashCookie}` } });
    const html = await page.text();
    expect(html).toContain("<title>Dash · CR Companion</title>");
    expect(html).toContain('href="/battles"');
    expect(html).toContain('class="active"');
    expect(html).toContain("Saved!");
    expect(html).toContain(user.username);
    expect(page.headers.get("set-cookie")).toContain("cr_flash=;");
  });
});
