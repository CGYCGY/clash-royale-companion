import { beforeEach, describe, expect, test } from "bun:test";
import type { User } from "../../src/types";
import { makeUser } from "../helpers";
import { ADMIN_TOKEN, type ApiTestEnv, apiKeyHeaders, type ErrorJson, sessionHeaders, setupApi } from "./support";

let env: ApiTestEnv;
let user: User;

beforeEach(() => {
  env = setupApi();
  user = makeUser();
});

describe("api auth", () => {
  test.each(["/api/me", "/api/players", "/api/players/9QJUGC2R", "/api/decks", "/api/cards", "/api/keys"])(
    "%s needs a user",
    async (path) => {
      const res = await env.app.request(path);
      expect(res.status).toBe(401);
      expect(((await res.json()) as ErrorJson).error.code).toBe("unauthorized");
    },
  );

  test("an invalid API key is rejected", async () => {
    const res = await env.app.request("/api/me", { headers: { Authorization: "Bearer crk_nope" } });
    expect(res.status).toBe(401);
  });

  test("admin endpoints reject user credentials and wrong tokens", async () => {
    expect((await env.app.request("/api/admin/invites")).status).toBe(401);
    expect((await env.app.request("/api/admin/invites", { headers: apiKeyHeaders(user) })).status).toBe(401);
    const wrong = await env.app.request("/api/admin/users", { headers: { Authorization: "Bearer wrong-token" } });
    expect(wrong.status).toBe(401);
    const ok = await env.app.request("/api/admin/users", { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
    expect(ok.status).toBe(200);
  });

  test("guards stay scoped: health is public", async () => {
    expect((await env.app.request("/api/health")).status).toBe(200);
  });

  test("GET /api/me reports the auth method", async () => {
    const viaKey = await env.app.request("/api/me", { headers: apiKeyHeaders(user) });
    expect(await viaKey.json()).toEqual({
      user: { id: user.id, username: user.username, createdAt: user.createdAt },
      authMethod: "apikey",
      players: [],
    });
    const viaSession = await env.app.request("/api/me", { headers: sessionHeaders(user) });
    expect(((await viaSession.json()) as { authMethod: string }).authMethod).toBe("session");
  });
});
