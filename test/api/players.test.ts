import { beforeEach, describe, expect, test } from "bun:test";
import { CrApiError } from "../../src/cr/client";
import type { PlayerRecord } from "../../src/repos/players";
import type { User } from "../../src/types";
import { FIXTURE_TAG, makeUser } from "../helpers";
import {
  type ApiTestEnv,
  apiKeyHeaders,
  type ErrorJson,
  jsonInit,
  linkFixturePlayer,
  sessionHeaders,
  setupApi,
} from "./support";

let env: ApiTestEnv;
let alice: User;
let auth: Record<string, string>;

beforeEach(() => {
  env = setupApi();
  alice = makeUser("alice");
  auth = apiKeyHeaders(alice);
});

const SLUG = FIXTURE_TAG.slice(1);

describe("linking players", () => {
  test("POST /api/players tracks and syncs the player", async () => {
    const res = await env.app.request("/api/players", jsonInit("POST", auth, { tag: "9qjugc2r" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { player: PlayerRecord; battlesAdded: number };
    expect(body.player).toMatchObject({ tag: FIXTURE_TAG, name: "Sparky", userId: alice.id });
    expect(body.battlesAdded).toBe(10);

    const list = (await (await env.app.request("/api/players", { headers: auth })).json()) as { players: PlayerRecord[] };
    expect(list.players).toHaveLength(1);
    expect(list.players[0]!.lastSyncedAt).not.toBeNull();
    expect(list.players[0]!.lastSyncError).toBeNull();
  });

  test("errors map to statuses", async () => {
    const bad = await env.app.request("/api/players", jsonInit("POST", auth, { tag: "not a tag!" }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as ErrorJson).error.code).toBe("invalid_tag");

    await env.app.request("/api/players", jsonInit("POST", auth, { tag: FIXTURE_TAG }));
    const dup = await env.app.request("/api/players", jsonInit("POST", auth, { tag: FIXTURE_TAG }));
    expect(dup.status).toBe(409);

    env.client.fail.getPlayer = new CrApiError(404, "notFound", "Player not found");
    const missing = await env.app.request("/api/players", jsonInit("POST", auth, { tag: "#2PP" }));
    expect(missing.status).toBe(404);

    env.client.fail.getPlayer = new CrApiError(503, "maintenance", "down");
    const upstream = await env.app.request("/api/players", jsonInit("POST", auth, { tag: "#2PP" }));
    expect(upstream.status).toBe(502);
    expect(((await upstream.json()) as ErrorJson).error.code).toBe("upstream_error");

    const noBody = await env.app.request("/api/players", jsonInit("POST", auth, {}));
    expect(noBody.status).toBe(400);
  });

  test("invalid tag in the path is 400", async () => {
    const res = await env.app.request("/api/players/hello!", { headers: auth });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorJson).error.code).toBe("invalid_tag");
  });

  test("DELETE /api/players/:tag", async () => {
    await linkFixturePlayer(alice, env.client);
    expect((await env.app.request(`/api/players/${SLUG}`, { method: "DELETE", headers: auth })).status).toBe(204);
    expect((await env.app.request(`/api/players/${SLUG}`, { method: "DELETE", headers: auth })).status).toBe(404);
  });
});

describe("player detail", () => {
  test("GET /api/players/:tag returns a trimmed profile with display-level deck", async () => {
    await linkFixturePlayer(alice, env.client);
    const res = await env.app.request(`/api/players/${SLUG}`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      player: PlayerRecord;
      snapshot: {
        fetchedAt: string;
        lastSeenAt: string;
        profile: Record<string, unknown>;
        currentDeck: {
          name: string;
          level: number;
          evolutionLevel: number;
          iconUrl: string | null;
          iconUrlHero: string | null;
          elixirCost: number | null;
        }[];
        currentDeckSupportCards: { name: string; level: number }[];
      };
    };
    expect(body.player.name).toBe("Sparky");
    expect(body.snapshot.lastSeenAt).toBe(body.snapshot.fetchedAt);
    const { profile, currentDeck } = body.snapshot;
    expect(profile.trophies).toBe(env.client.player.trophies);
    for (const key of ["cards", "achievements", "badges", "supportCards", "currentDeck"]) {
      expect(profile).not.toHaveProperty(key);
    }
    expect(currentDeck).toHaveLength(8);
    // The Log is API level 5 as a legendary, i.e. level 13 in game.
    expect(currentDeck.find((c) => c.name === "The Log")).toMatchObject({ level: 13, elixirCost: 2 });
    expect(currentDeck.every((c) => c.iconUrl?.startsWith("https://"))).toBe(true);
    expect(body.snapshot.currentDeckSupportCards[0]).toMatchObject({ name: "Tower Princess", level: 14 });
    expect(body.snapshot).not.toHaveProperty("chests");
    expect(profile).toMatchObject({ kingTowerLevel: 15, collectionLevel: 546, currentWinLoseStreak: 3 });
    expect(currentDeck.find((c) => c.name === "Ice Golem")).toMatchObject({ evolutionLevel: 2 });
    expect(currentDeck.find((c) => c.name === "Ice Golem")!.iconUrlHero).toContain("/cardheroes/");
    // Rare Hog Rider: API maxLevel 14 is display level 16, like every other level in the response.
    expect(profile.currentFavouriteCard).toMatchObject({ name: "Hog Rider", maxLevel: 16 });
  });

  test("a player without a snapshot has snapshot null", async () => {
    env.client.fail.getPlayerBattleLog = new CrApiError(503, "maintenance", "down");
    await linkFixturePlayer(alice, env.client);
    const body = (await (await env.app.request(`/api/players/${SLUG}`, { headers: auth })).json()) as {
      snapshot: unknown;
    };
    expect(body.snapshot).toBeNull();
  });
});

describe("ownership isolation", () => {
  test("another user gets 404 on every per-player route", async () => {
    await linkFixturePlayer(alice, env.client);
    const bob = sessionHeaders(makeUser("bob"));
    const paths = ["", "/battles", "/battles/1", "/stats", "/cards", "/notes", "/context.md", "/context"];
    for (const p of paths) {
      const res = await env.app.request(`/api/players/${SLUG}${p}`, { headers: bob });
      expect({ p, status: res.status }).toEqual({ p, status: 404 });
    }
    const writes: [string, string][] = [
      ["PUT", "/notes"],
      ["POST", "/sync"],
      ["DELETE", ""],
    ];
    for (const [method, p] of writes) {
      const res = await env.app.request(`/api/players/${SLUG}${p}`, jsonInit(method, bob, { content: "x" }));
      expect({ method, p, status: res.status }).toEqual({ method, p, status: 404 });
    }
    const list = (await (await env.app.request("/api/players", { headers: bob })).json()) as { players: unknown[] };
    expect(list.players).toEqual([]);
    expect((await env.app.request(`/api/players/${SLUG}`, { headers: auth })).status).toBe(200);
  });
});
