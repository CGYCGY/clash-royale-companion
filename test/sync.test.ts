import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createSession, getUserBySessionToken } from "../src/auth/sessions";
import { config } from "../src/config";
import { CrApiError } from "../src/cr/client";
import { getDb } from "../src/db";
import { countBattles } from "../src/repos/battles";
import { countCards, getCardByName } from "../src/repos/cards";
import {
  addPlayer,
  getLatestSnapshot,
  getPlayer,
  getTrophyHistory,
  insertSnapshot,
  listAllPlayers,
  removePlayer,
} from "../src/repos/players";
import * as syncRuns from "../src/repos/syncRuns";
import { listRecentSyncRuns } from "../src/repos/syncRuns";
import { manualSync, runDailyJob, runSyncJob, syncAll, syncCards, syncPlayer, trackPlayer } from "../src/sync";
import type { User } from "../src/types";
import { FakeCrClient, FIXTURE_TAG, makeTestDb, makeUser, seedCards } from "./helpers";

let user: User;
let client: FakeCrClient;

const snapshotCount = () =>
  getDb().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM player_snapshots").get()!.n;

beforeEach(() => {
  makeTestDb();
  seedCards();
  user = makeUser();
  client = new FakeCrClient();
  config.SYNC_COOLDOWN_SECONDS = 300;
});

describe("syncPlayer", () => {
  test("stores snapshot, battles, player name, and an ok sync run", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    const r = await syncPlayer(FIXTURE_TAG, client);
    expect(r).toEqual({ battlesAdded: 10, snapshotInserted: true });
    expect(countBattles(FIXTURE_TAG)).toBe(10);
    const snap = getLatestSnapshot(FIXTURE_TAG)!;
    expect(snap.player.name).toBe("Sparky");
    expect(snap.chests?.items.length).toBeGreaterThan(0);
    const p = getPlayer(FIXTURE_TAG)!;
    expect(p.name).toBe("Sparky");
    expect(p.lastSyncedAt).not.toBeNull();
    expect(p.lastSyncError).toBeNull();
    const [run] = listRecentSyncRuns({ tag: FIXTURE_TAG });
    expect(run).toMatchObject({ status: "ok", battlesAdded: 10, error: null });
    expect(run!.finishedAt).not.toBeNull();
    expect(getTrophyHistory(FIXTURE_TAG)).toEqual([
      expect.objectContaining({ trophies: 7584, bestTrophies: 8012, polLeague: 7 }),
    ]);
  });

  test("an unchanged second sync de-duplicates battles and the snapshot, advancing last_seen_at", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    await syncPlayer(FIXTURE_TAG, client);
    const old = "2026-01-01T00:00:00.000Z";
    getDb().query("UPDATE player_snapshots SET fetched_at = ?, last_seen_at = ?").run(old, old);
    const second = await syncPlayer(FIXTURE_TAG, client);
    expect(second).toEqual({ battlesAdded: 0, snapshotInserted: false });
    expect(countBattles(FIXTURE_TAG)).toBe(10);
    expect(snapshotCount()).toBe(1);
    const snap = getLatestSnapshot(FIXTURE_TAG)!;
    expect(snap.fetchedAt).toBe(old);
    expect(snap.lastSeenAt > old).toBe(true);
  });

  test("a trophy change stores a new snapshot", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    await syncPlayer(FIXTURE_TAG, client);
    client.player = { ...client.player, trophies: client.player.trophies + 30 };
    expect((await syncPlayer(FIXTURE_TAG, client)).snapshotInserted).toBe(true);
    expect(snapshotCount()).toBe(2);
    expect(getLatestSnapshot(FIXTURE_TAG)!.player.trophies).toBe(client.player.trophies);
  });

  test("a chests-only change stores a new snapshot", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    await syncPlayer(FIXTURE_TAG, client);
    client.chests = { items: client.chests.items.slice(1) };
    expect((await syncPlayer(FIXTURE_TAG, client)).snapshotInserted).toBe(true);
    expect(snapshotCount()).toBe(2);
  });

  test("chest endpoint failure is non-fatal", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    client.fail.getUpcomingChests = new CrApiError(500, "unknown", "boom");
    const r = await syncPlayer(FIXTURE_TAG, client);
    expect(r.error).toBeUndefined();
    expect(getLatestSnapshot(FIXTURE_TAG)!.chests).toBeNull();
  });

  test("a malformed battle entry doesn't roll back the snapshot or the other battles", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    const broken = structuredClone(client.battleLog[0]!);
    broken.battleTime = "not-a-time";
    const noCards = structuredClone(client.battleLog[1]!);
    delete (noCards.team[0] as { cards?: unknown }).cards;
    client.battleLog = [broken, noCards, ...client.battleLog.slice(2)];
    const r = await syncPlayer(FIXTURE_TAG, client);
    expect(r).toEqual({ battlesAdded: 9, snapshotInserted: true });
    expect(snapshotCount()).toBe(1);
    expect(getPlayer(FIXTURE_TAG)!.lastSyncError).toBeNull();
  });

  test("API errors are recorded, not thrown", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    client.fail.getPlayer = new CrApiError(403, "accessDenied", "denied: check allowlist");
    const r = await syncPlayer(FIXTURE_TAG, client);
    expect(r).toEqual({ battlesAdded: 0, snapshotInserted: false, error: "denied: check allowlist", errorStatus: 403 });
    expect(getPlayer(FIXTURE_TAG)!.lastSyncError).toBe("denied: check allowlist");
    expect(getPlayer(FIXTURE_TAG)!.lastSyncedAt).toBeNull();
    expect(listRecentSyncRuns({ tag: FIXTURE_TAG })[0]).toMatchObject({ status: "error" });
    expect(snapshotCount()).toBe(0);
  });
});

describe("insertSnapshot", () => {
  const T1 = "2026-09-01T10:00:00.000Z";
  const T2 = "2026-09-01T11:00:00.000Z";
  const T3 = "2026-09-01T12:00:00.000Z";

  test("returns inserted/id and exposes fetchedAt and lastSeenAt separately", () => {
    addPlayer(user.id, FIXTURE_TAG);
    const first = insertSnapshot(FIXTURE_TAG, client.player, client.chests, T1);
    expect(first.inserted).toBe(true);
    expect(getLatestSnapshot(FIXTURE_TAG)).toMatchObject({ fetchedAt: T1, lastSeenAt: T1 });
    expect(insertSnapshot(FIXTURE_TAG, client.player, client.chests, T2)).toEqual({ inserted: false, id: first.id });
    expect(getLatestSnapshot(FIXTURE_TAG)).toMatchObject({ fetchedAt: T1, lastSeenAt: T2 });
    expect(snapshotCount()).toBe(1);
  });

  test("an out-of-order older fetch does not move last_seen_at backwards", () => {
    addPlayer(user.id, FIXTURE_TAG);
    insertSnapshot(FIXTURE_TAG, client.player, null, T1);
    insertSnapshot(FIXTURE_TAG, client.player, null, T3);
    insertSnapshot(FIXTURE_TAG, client.player, null, T2);
    expect(getLatestSnapshot(FIXTURE_TAG)!.lastSeenAt).toBe(T3);
  });

  test("trophy history keeps points at fetched_at and carries lastSeenAt", () => {
    addPlayer(user.id, FIXTURE_TAG);
    insertSnapshot(FIXTURE_TAG, client.player, null, T1);
    insertSnapshot(FIXTURE_TAG, client.player, null, T2);
    insertSnapshot(FIXTURE_TAG, { ...client.player, trophies: 7600 }, null, T3);
    expect(getTrophyHistory(FIXTURE_TAG)).toEqual([
      expect.objectContaining({ fetchedAt: T1, lastSeenAt: T2, trophies: 7584 }),
      expect.objectContaining({ fetchedAt: T3, lastSeenAt: T3, trophies: 7600 }),
    ]);
  });
});

describe("manualSync", () => {
  test("enforces the cooldown from the last attempt", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    expect(await manualSync(FIXTURE_TAG, client)).toEqual({ ok: true, battlesAdded: 10 });
    const again = await manualSync(FIXTURE_TAG, client);
    expect(again.ok).toBe(false);
    expect("retryAfterSeconds" in again && again.retryAfterSeconds).toBeGreaterThan(290);
    expect(client.calls.getPlayer).toBe(1);
    const later = new Date(Date.now() + 301_000);
    expect(await manualSync(FIXTURE_TAG, client, later)).toEqual({ ok: true, battlesAdded: 0 });
  });

  test("failed attempts also start the cooldown", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    client.fail.getPlayer = new CrApiError(429, "requestThrottled", "rate limited");
    expect(await manualSync(FIXTURE_TAG, client)).toEqual({ ok: false, error: "rate limited" });
    expect((await manualSync(FIXTURE_TAG, client)).ok).toBe(false);
    expect(client.calls.getPlayer).toBe(1);
  });

  test("concurrent calls only sync once", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    const [a, b] = await Promise.all([manualSync(FIXTURE_TAG, client), manualSync(FIXTURE_TAG, client)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(client.calls.getPlayer).toBe(1);
  });
});

describe("syncCards / syncAll / trackPlayer", () => {
  test("syncCards loads cards and tower troops", async () => {
    makeTestDb();
    expect(countCards()).toBe(0);
    expect(await syncCards(client)).toBe(42);
    expect(getCardByName("tower princess")?.kind).toBe("support");
    expect(getCardByName("Knight")?.iconUrlEvo).toBeTruthy();
    expect(getCardByName("Mirror")?.elixirCost).toBeNull();
  });

  test("syncAll visits every player and counts failures", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    addPlayer(user.id, "#PYVJ98G2");
    const r = await syncAll(client, { delayMs: 0 });
    // Both players get the same fixture battle log, but battles are keyed per player tag.
    expect(r).toEqual({ players: 2, failed: 0, skipped: 0, battlesAdded: 20, snapshotsInserted: 2, rateLimited: false });
  });

  test("syncAll skips a player removed mid-run and keeps going", async () => {
    for (const tag of [FIXTURE_TAG, "#PYVJ98G2", "#8LQ2R0YCP"]) addPlayer(user.id, tag);
    const [first, second, third] = listAllPlayers().map((p) => p.tag);
    const realGetPlayer = client.getPlayer.bind(client);
    client.getPlayer = async (tag: string) => {
      if (tag === first) removePlayer(second!, user.id);
      return realGetPlayer(tag);
    };
    const r = await syncAll(client, { delayMs: 0 });
    expect(r).toEqual({ players: 3, failed: 0, skipped: 1, battlesAdded: 20, snapshotsInserted: 2, rateLimited: false });
    expect(countBattles(first!)).toBe(10);
    expect(countBattles(third!)).toBe(10);
  });

  test("syncAll survives a player whose sync throws outside syncPlayer's own handling", async () => {
    addPlayer(user.id, FIXTURE_TAG);
    addPlayer(user.id, "#PYVJ98G2");
    const spy = spyOn(syncRuns, "startSyncRun").mockImplementationOnce(() => {
      throw new Error("FOREIGN KEY constraint failed");
    });
    try {
      const r = await syncAll(client, { delayMs: 0 });
      expect(r).toMatchObject({ players: 2, failed: 1, battlesAdded: 10 });
    } finally {
      spy.mockRestore();
    }
  });

  test("syncAll stops at a 429 and reports the rest as skipped", async () => {
    for (const tag of [FIXTURE_TAG, "#PYVJ98G2", "#8LQ2R0YCP"]) addPlayer(user.id, tag);
    client.fail.getPlayer = new CrApiError(429, "requestThrottled", "rate limited", 30);
    const r = await syncAll(client, { delayMs: 0 });
    expect(r).toEqual({ players: 3, failed: 1, skipped: 2, battlesAdded: 0, snapshotsInserted: 0, rateLimited: true });
    expect(client.calls.getPlayer).toBe(1);
    const single = await syncPlayer(FIXTURE_TAG, client);
    expect(single).toMatchObject({ errorStatus: 429, retryAfterSeconds: 30 });
  });

  test("sync job reloads an empty card catalog before syncing players", async () => {
    makeTestDb();
    const u = makeUser();
    addPlayer(u.id, FIXTURE_TAG);
    expect(countCards()).toBe(0);
    const r = await runSyncJob(client, { delayMs: 0 });
    expect(countCards()).toBe(42);
    expect(r.battlesAdded).toBe(10);
    await runSyncJob(client, { delayMs: 0 });
    expect(client.calls.getCards).toBe(1);
  });

  test("sync job still syncs players when the catalog retry fails", async () => {
    makeTestDb();
    addPlayer(makeUser().id, FIXTURE_TAG);
    client.fail.getCards = new CrApiError(503, "inMaintenance", "maintenance");
    const r = await runSyncJob(client, { delayMs: 0 });
    expect(r.battlesAdded).toBe(10);
  });

  test("daily job purges sessions even when the card refresh fails", async () => {
    const expired = createSession(user.id, new Date(Date.now() - 400 * 86_400_000));
    const live = createSession(user.id);
    client.fail.getCards = new CrApiError(503, "inMaintenance", "maintenance");
    const r = await runDailyJob(client);
    expect(r).toMatchObject({ cards: null, purged: 1 });
    expect(getUserBySessionToken(expired)).toBeNull();
    expect(getUserBySessionToken(live)?.id).toBe(user.id);
  });

  test("trackPlayer normalizes, verifies upstream, adds, and syncs", async () => {
    const r = await trackPlayer(user.id, "9qjugc2r", client);
    expect(r.player).toMatchObject({ tag: FIXTURE_TAG, userId: user.id, name: "Sparky" });
    expect(r.battlesAdded).toBe(10);

    const other = makeUser("bob");
    const conflict = await trackPlayer(other.id, FIXTURE_TAG, client).catch((e) => e);
    expect(conflict.code).toBe("conflict");

    client.fail.getPlayer = new CrApiError(404, "notFound", "not found");
    const missing = await trackPlayer(user.id, "#PYVJ98G2", client).catch((e) => e);
    expect(missing.code).toBe("not_found");
    expect(getPlayer("#PYVJ98G2")).toBeNull();

    const invalid = await trackPlayer(user.id, "#ABC", client).catch((e) => e);
    expect(invalid.code).toBe("invalid_tag");
  });
});
