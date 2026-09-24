import { beforeEach, describe, expect, test } from "bun:test";
import { config } from "../../src/config";
import { CrApiError } from "../../src/cr/client";
import type { CollectionEntry, CollectionSummary } from "../../src/domain/collection";
import type { BattleRecord, BattleStats } from "../../src/repos/battles";
import type { TrophyPoint } from "../../src/repos/players";
import type { User } from "../../src/types";
import { FIXTURE_TAG, makeUser } from "../helpers";
import { type ApiTestEnv, apiKeyHeaders, type ErrorJson, jsonInit, linkFixturePlayer, setupApi } from "./support";

let env: ApiTestEnv;
let alice: User;
let auth: Record<string, string>;
const base = `/api/players/${FIXTURE_TAG.slice(1)}`;

beforeEach(async () => {
  env = setupApi();
  alice = makeUser("alice");
  auth = apiKeyHeaders(alice);
  await linkFixturePlayer(alice, env.client);
});

const get = async <T>(path: string): Promise<T> => {
  const res = await env.app.request(path, { headers: auth });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
};

describe("battles", () => {
  test("lists newest first with total", async () => {
    const { battles, total } = await get<{ battles: BattleRecord[]; total: number }>(`${base}/battles`);
    expect(total).toBe(10);
    expect(battles).toHaveLength(10);
    expect(battles[0]!.battleTime > battles[9]!.battleTime).toBe(true);
  });

  test("filters by mode, result, time window, and paginates", async () => {
    const ladder = await get<{ battles: BattleRecord[]; total: number }>(`${base}/battles?mode=Ladder`);
    expect(ladder.total).toBe(5);
    const pol = await get<{ total: number }>(`${base}/battles?mode=pathOfLegend`);
    expect(pol.total).toBe(3);
    const draws = await get<{ battles: BattleRecord[]; total: number }>(`${base}/battles?result=draw`);
    expect(draws.total).toBe(1);
    expect(draws.battles[0]!.result).toBe("draw");

    const all = await get<{ battles: BattleRecord[] }>(`${base}/battles`);
    const page = await get<{ battles: BattleRecord[]; total: number }>(`${base}/battles?limit=3&offset=2`);
    expect(page.total).toBe(10);
    expect(page.battles.map((b) => b.id)).toEqual(all.battles.slice(2, 5).map((b) => b.id));

    const cut = all.battles[4]!.battleTime;
    const since = await get<{ total: number }>(`${base}/battles?since=${encodeURIComponent(cut)}`);
    expect(since.total).toBe(5);
    const until = await get<{ total: number }>(`${base}/battles?until=${encodeURIComponent(cut)}`);
    expect(until.total).toBe(5);
  });

  test("rejects bad query values", async () => {
    for (const q of ["result=tie", "limit=0", "limit=501", "offset=-1", "since=yesterday"]) {
      const res = await env.app.request(`${base}/battles?${q}`, { headers: auth });
      expect({ q, status: res.status }).toEqual({ q, status: 400 });
    }
  });

  test("GET one battle includes the raw entry", async () => {
    const { battles } = await get<{ battles: BattleRecord[] }>(`${base}/battles?limit=1`);
    const { battle } = await get<{ battle: BattleRecord & { raw: { gameMode: { name: string } } } }>(
      `${base}/battles/${battles[0]!.id}`,
    );
    expect(battle.id).toBe(battles[0]!.id);
    expect(battle.raw.gameMode.name).toBe(battle.gameModeName);
    expect((await env.app.request(`${base}/battles/999999`, { headers: auth })).status).toBe(404);
    expect((await env.app.request(`${base}/battles/abc`, { headers: auth })).status).toBe(400);
  });
});

describe("stats", () => {
  test("defaults to 30 days and includes trophy history", async () => {
    const { stats, trophyHistory } = await get<{ stats: BattleStats; trophyHistory: TrophyPoint[] }>(`${base}/stats`);
    expect(stats.sinceDays).toBe(30);
    expect(stats.total).toBe(10);
    expect(stats.wins + stats.losses + stats.draws).toBe(10);
    expect(stats.byMode.find((m) => m.mode === "Ladder")?.games).toBe(5);
    expect(trophyHistory).toHaveLength(1);
    expect(trophyHistory[0]!.trophies).toBe(env.client.player.trophies);
  });

  test("validates days", async () => {
    const { stats } = await get<{ stats: BattleStats }>(`${base}/stats?days=7`);
    expect(stats.sinceDays).toBe(7);
    const ladder = await get<{ stats: BattleStats }>(`${base}/stats?mode=Ladder`);
    expect(ladder.stats.total).toBe(5);
    expect(ladder.stats.byMode.map((m) => m.mode)).toEqual(["Ladder"]);
    expect((await env.app.request(`${base}/stats?days=0`, { headers: auth })).status).toBe(400);
    expect((await env.app.request(`${base}/stats?days=366`, { headers: auth })).status).toBe(400);
  });
});

describe("cards", () => {
  test("collection summary and entries use display levels", async () => {
    const { summary, cards } = await get<{ summary: CollectionSummary; cards: CollectionEntry[] }>(`${base}/cards`);
    expect(summary).toMatchObject({ total: 39, owned: 37, missing: 2, maxed: 0, upgradeReady: 17 });
    expect(summary.byRarity.map((r) => r.rarity)).toEqual(["common", "rare", "epic", "legendary", "champion"]);
    expect(summary.byRarity.find((r) => r.rarity === "champion")).toEqual({
      rarity: "champion",
      total: 1,
      owned: 0,
      avgLevel: null,
    });

    const log = cards.find((c) => c.name === "The Log")!;
    expect(log).toMatchObject({
      level: 13,
      maxLevel: 16,
      countNeeded: 12,
      goldNeeded: 60_000,
      goldToMax: 270_000,
      copiesToMax: 0,
      upgradeReady: true,
      owned: true,
    });
    const knight = cards.find((c) => c.name === "Knight")!;
    expect(knight).toMatchObject({
      level: 14,
      count: 102,
      countNeeded: 5500,
      goldNeeded: 90_000,
      goldToMax: 210_000,
      copiesToMax: 12_898,
      upgradeReady: false,
      evolutionLevel: 1,
    });
    const queen = cards.find((c) => c.name === "Archer Queen")!;
    expect(queen).toMatchObject({
      owned: false,
      level: null,
      countNeeded: null,
      goldNeeded: null,
      goldToMax: null,
      copiesToMax: null,
      upgradeReady: false,
    });

    // Owned first, unowned next, tower troops last.
    const firstMissing = cards.findIndex((c) => !c.owned);
    expect(cards.slice(0, firstMissing).every((c) => c.owned && c.kind === "card")).toBe(true);
    expect(cards.slice(-3).every((c) => c.kind === "support")).toBe(true);
  });
});

describe("notes", () => {
  test("round trip", async () => {
    expect(await get<{ notes: unknown }>(`${base}/notes`)).toEqual({ notes: null });
    const put = await env.app.request(`${base}/notes`, jsonInit("PUT", auth, { content: "# Budget\nNo gems." }));
    expect(put.status).toBe(200);
    const { notes } = await get<{ notes: { content: string; updatedAt: string } }>(`${base}/notes`);
    expect(notes.content).toBe("# Budget\nNo gems.");
    expect(notes.updatedAt).toEqual(expect.any(String));
  });

  test("rejects over 20k chars", async () => {
    const res = await env.app.request(`${base}/notes`, jsonInit("PUT", auth, { content: "x".repeat(20_001) }));
    expect(res.status).toBe(400);
  });
});

describe("manual sync", () => {
  test("cooldown returns 429 with Retry-After", async () => {
    const res = await env.app.request(`${base}/sync`, { method: "POST", headers: auth });
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get("Retry-After"));
    expect(retry).toBeGreaterThan(0);
    const body = (await res.json()) as ErrorJson;
    expect(body.error.code).toBe("cooldown");
    expect(body.error.details).toEqual({ retryAfterSeconds: retry });
  });

  test("syncs when the cooldown has passed", async () => {
    config.SYNC_COOLDOWN_SECONDS = 0;
    const res = await env.app.request(`${base}/sync`, { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, battlesAdded: 0 });
  });

  test("upstream failure is 502", async () => {
    config.SYNC_COOLDOWN_SECONDS = 0;
    env.client.fail.getPlayer = new CrApiError(503, "maintenance", "Clash Royale API is under maintenance");
    const res = await env.app.request(`${base}/sync`, { method: "POST", headers: auth });
    expect(res.status).toBe(502);
    expect(((await res.json()) as ErrorJson).error).toMatchObject({ code: "upstream_error" });
  });
});

describe("context", () => {
  test("context.md is markdown with every section", async () => {
    await env.app.request(`${base}/notes`, jsonInit("PUT", auth, { content: "Goal: reach league 8." }));
    await env.app.request(
      "/api/decks",
      jsonInit("POST", auth, {
        name: "Hog 2.6",
        cards: ["Hog Rider", "Musketeer", "Ice Golem", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"],
      }),
    );
    const res = await env.app.request(`${base}/context.md`, { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const md = await res.text();
    for (const heading of [
      "## Profile",
      "## Current deck",
      "## Upcoming chests",
      "## Recent performance",
      "## Last battles",
      "## Collection",
      "## Saved decks",
      "## Player notes",
      "## Data limitations",
    ]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("Sparky (#9QJUGC2R)");
    expect(md).toContain("Goal: reach league 8.");
    expect(md).toContain("**Hog 2.6** (ai)");

    const json = await get<{ markdown: string }>(`${base}/context`);
    expect(json.markdown).toBe(md);
  });
});
