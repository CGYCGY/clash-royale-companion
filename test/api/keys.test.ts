import { beforeEach, describe, expect, test } from "bun:test";
import type { User } from "../../src/types";
import { makeUser } from "../helpers";
import { type ApiTestEnv, apiKeyHeaders, jsonInit, sessionHeaders, setupApi } from "./support";

let env: ApiTestEnv;
let alice: User;
let session: Record<string, string>;

beforeEach(() => {
  env = setupApi();
  alice = makeUser("alice");
  session = sessionHeaders(alice);
});

describe("api keys", () => {
  test("session can create, list, and revoke; the raw key works once created", async () => {
    const res = await env.app.request("/api/keys", jsonInit("POST", session, { name: "Claude" }));
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as { key: { id: number; name: string; raw: string; keyPrefix: string } };
    expect(key.name).toBe("Claude");
    expect(key.raw).toStartWith(key.keyPrefix);

    const me = await env.app.request("/api/me", { headers: { Authorization: `Bearer ${key.raw}` } });
    expect(me.status).toBe(200);

    const list = (await (await env.app.request("/api/keys", { headers: session })).json()) as {
      keys: Record<string, unknown>[];
    };
    expect(list.keys).toHaveLength(1);
    expect(list.keys[0]).not.toHaveProperty("raw");
    expect(Object.keys(list.keys[0]!).some((k) => k.toLowerCase().includes("hash"))).toBe(false);

    expect((await env.app.request(`/api/keys/${key.id}`, { method: "DELETE", headers: session })).status).toBe(204);
    expect((await env.app.request(`/api/keys/${key.id}`, { method: "DELETE", headers: session })).status).toBe(404);
    const after = await env.app.request("/api/me", { headers: { Authorization: `Bearer ${key.raw}` } });
    expect(after.status).toBe(401);
  });

  test("API keys cannot manage keys", async () => {
    const viaKey = apiKeyHeaders(alice);
    expect((await env.app.request("/api/keys", { headers: viaKey })).status).toBe(403);
    expect((await env.app.request("/api/keys", jsonInit("POST", viaKey, { name: "x" }))).status).toBe(403);
    expect((await env.app.request("/api/keys/1", { method: "DELETE", headers: viaKey })).status).toBe(403);
    expect((await env.app.request("/api/keys")).status).toBe(401);
  });

  test("validates the name and scopes revocation to the owner", async () => {
    expect((await env.app.request("/api/keys", jsonInit("POST", session, { name: "" }))).status).toBe(400);
    expect((await env.app.request("/api/keys", jsonInit("POST", session, { name: "x".repeat(61) }))).status).toBe(400);
    const res = await env.app.request("/api/keys", jsonInit("POST", session, { name: "mine" }));
    const { key } = (await res.json()) as { key: { id: number } };
    const bob = sessionHeaders(makeUser("bob"));
    expect((await env.app.request(`/api/keys/${key.id}`, { method: "DELETE", headers: bob })).status).toBe(404);
  });
});
