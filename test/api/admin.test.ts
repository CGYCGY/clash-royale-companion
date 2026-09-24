import { beforeEach, describe, expect, test } from "bun:test";
import type { InviteRecord } from "../../src/auth/invites";
import { currentAdminSync } from "../../src/routes/api/admin";
import type { SyncRunRecord } from "../../src/repos/syncRuns";
import { FIXTURE_TAG, makeUser } from "../helpers";
import { ADMIN_TOKEN, type ApiTestEnv, type ErrorJson, jsonInit, linkFixturePlayer, setupApi } from "./support";

type InviteJson = InviteRecord & { usable: boolean };

let env: ApiTestEnv;
const admin = { Authorization: `Bearer ${ADMIN_TOKEN}` };

beforeEach(() => {
  env = setupApi();
});

describe("admin invites", () => {
  test("create, list, revoke", async () => {
    const created = await env.app.request("/api/admin/invites", { method: "POST", headers: admin });
    expect(created.status).toBe(201);
    const { invite } = (await created.json()) as { invite: InviteJson };
    expect(invite.code).toHaveLength(12);
    expect(invite).toMatchObject({ maxUses: 1, uses: 0, usable: true });
    const days = (Date.parse(invite.expiresAt!) - Date.parse(invite.createdAt)) / 86_400_000;
    expect(days).toBe(7);

    const custom = await env.app.request("/api/admin/invites", jsonInit("POST", admin, { maxUses: 5, expiresInDays: 30 }));
    expect(((await custom.json()) as { invite: InviteJson }).invite.maxUses).toBe(5);

    const del = await env.app.request(`/api/admin/invites/${invite.id}`, { method: "DELETE", headers: admin });
    expect(del.status).toBe(204);
    const again = await env.app.request(`/api/admin/invites/${invite.id}`, { method: "DELETE", headers: admin });
    expect(again.status).toBe(404);

    const { invites } = (await (await env.app.request("/api/admin/invites", { headers: admin })).json()) as {
      invites: InviteJson[];
    };
    expect(invites).toHaveLength(2);
    expect(invites.find((i) => i.id === invite.id)?.usable).toBe(false);
    expect(invites.find((i) => i.id !== invite.id)?.usable).toBe(true);
  });

  test("validates options", async () => {
    for (const body of [{ maxUses: 0 }, { maxUses: 101 }, { expiresInDays: 366 }]) {
      const res = await env.app.request("/api/admin/invites", jsonInit("POST", admin, body));
      expect(res.status).toBe(400);
    }
    const bad = await env.app.request("/api/admin/invites", {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: "{nope",
    });
    expect(bad.status).toBe(400);
  });
});

describe("admin users and sync", () => {
  test("users list includes tracked tags", async () => {
    const alice = makeUser("alice");
    makeUser("bob");
    await linkFixturePlayer(alice, env.client);
    const { users } = (await (await env.app.request("/api/admin/users", { headers: admin })).json()) as {
      users: { username: string; players: string[] }[];
    };
    expect(users.map((u) => [u.username, u.players])).toEqual([
      ["alice", [FIXTURE_TAG]],
      ["bob", []],
    ]);
  });

  test("POST /api/admin/sync runs in the background and does not overlap", async () => {
    await linkFixturePlayer(makeUser("alice"), env.client);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const getPlayer = env.client.getPlayer.bind(env.client);
    env.client.getPlayer = async (tag) => {
      await gate;
      return getPlayer(tag);
    };
    const first = await env.app.request("/api/admin/sync", { method: "POST", headers: admin });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ started: true });
    const second = await env.app.request("/api/admin/sync", { method: "POST", headers: admin });
    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorJson).error.code).toBe("conflict");

    const origLog = console.log;
    console.log = () => {};
    release();
    await currentAdminSync();
    console.log = origLog;
    expect(currentAdminSync()).toBeNull();

    const { runs } = (await (await env.app.request("/api/admin/sync-runs?limit=5", { headers: admin })).json()) as {
      runs: SyncRunRecord[];
    };
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === "ok")).toBe(true);
    expect((await env.app.request("/api/admin/sync-runs?limit=0", { headers: admin })).status).toBe(400);
  });
});
