import { beforeEach, describe, expect, test } from "bun:test";
import type { Player } from "../../src/cr/types";
import { loadConfig } from "../../src/config";
import { getDb } from "../../src/db";
import { addPlayer, getLatestSnapshot, insertSnapshot } from "../../src/repos/players";
import { pruneSnapshots } from "../../src/sync/retention";
import { FIXTURE_TAG, loadFixture, makeTestDb, makeUser } from "../helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const OTHER_TAG = "#2PP";
const player = loadFixture<Player>("player");

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number, hour = 12) => {
  const t = new Date(NOW.getTime() - d * 86_400_000);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString();
};

const fetchedTimes = (tag: string): string[] =>
  getDb()
    .query<{ fetched_at: string }, [string]>(
      "SELECT fetched_at FROM player_snapshots WHERE player_tag = ? ORDER BY fetched_at",
    )
    .all(tag)
    .map((r) => r.fetched_at);

// Identical payloads would be deduped on insert, so each snapshot gets its own trophy count.
let seq = 0;
const snap = (tag: string, at: string) => insertSnapshot(tag, { ...player, tag, trophies: ++seq }, at);

beforeEach(() => {
  makeTestDb();
  const user = makeUser();
  addPlayer(user.id, FIXTURE_TAG);
  addPlayer(user.id, OTHER_TAG);
});

describe("pruneSnapshots", () => {
  test("the default config keeps everything forever", () => {
    // The live `config` may come from a developer's .env, so read the schema defaults directly.
    const defaults = loadConfig({});
    snap(FIXTURE_TAG, hoursAgo(1));
    for (const hour of [0, 6, 23]) snap(FIXTURE_TAG, daysAgo(10, hour));
    snap(FIXTURE_TAG, daysAgo(400));
    const policy = { keepAllDays: defaults.SNAPSHOT_KEEP_ALL_DAYS, keepDailyDays: defaults.SNAPSHOT_KEEP_DAILY_DAYS };
    expect(pruneSnapshots(policy, NOW)).toEqual({ deleted: 0, remaining: 5 });
  });

  test("keepAllDays 0 never thins; keepDailyDays still deletes by age", () => {
    snap(FIXTURE_TAG, hoursAgo(1));
    for (const hour of [0, 6]) snap(FIXTURE_TAG, daysAgo(30, hour));
    snap(FIXTURE_TAG, daysAgo(91));
    expect(pruneSnapshots({ keepAllDays: 0, keepDailyDays: 90 }, NOW)).toEqual({ deleted: 1, remaining: 3 });
  });

  test("keepDailyDays 0 never deletes by age; keepAllDays still thins", () => {
    snap(FIXTURE_TAG, hoursAgo(1));
    for (const hour of [0, 6]) snap(FIXTURE_TAG, daysAgo(400, hour));
    const r = pruneSnapshots({ keepAllDays: 7, keepDailyDays: 0 }, NOW);
    expect(r).toEqual({ deleted: 1, remaining: 2 });
    expect(fetchedTimes(FIXTURE_TAG)).toEqual([daysAgo(400, 6), hoursAgo(1)]);
  });

  test("keeps everything inside the keep-all window", () => {
    for (let h = 0; h < 24 * 6; h += 3) snap(FIXTURE_TAG, hoursAgo(h));
    const before = fetchedTimes(FIXTURE_TAG).length;
    expect(pruneSnapshots({ keepAllDays: 7, keepDailyDays: 90 }, NOW)).toEqual({ deleted: 0, remaining: before });
  });

  test("keeps only the last snapshot per UTC day between the windows", () => {
    snap(FIXTURE_TAG, hoursAgo(1));
    for (const hour of [0, 6, 23]) snap(FIXTURE_TAG, daysAgo(10, hour));
    for (const hour of [1, 22]) snap(FIXTURE_TAG, daysAgo(30, hour));
    const r = pruneSnapshots({ keepAllDays: 7, keepDailyDays: 90 }, NOW);
    expect(r.deleted).toBe(3);
    expect(fetchedTimes(FIXTURE_TAG)).toEqual([daysAgo(30, 22), daysAgo(10, 23), hoursAgo(1)]);
  });

  test("deletes snapshots older than the daily window", () => {
    snap(FIXTURE_TAG, hoursAgo(1));
    snap(FIXTURE_TAG, daysAgo(89));
    snap(FIXTURE_TAG, daysAgo(91));
    snap(FIXTURE_TAG, daysAgo(400));
    const r = pruneSnapshots({ keepAllDays: 7, keepDailyDays: 90 }, NOW);
    expect(r).toEqual({ deleted: 2, remaining: 2 });
    expect(fetchedTimes(FIXTURE_TAG)).toEqual([daysAgo(89), hoursAgo(1)]);
  });

  test("always keeps the newest snapshot per player, however old", () => {
    snap(FIXTURE_TAG, daysAgo(200, 1));
    snap(FIXTURE_TAG, daysAgo(200, 5));
    snap(FIXTURE_TAG, daysAgo(300));
    snap(OTHER_TAG, daysAgo(500));
    const r = pruneSnapshots({ keepAllDays: 7, keepDailyDays: 90 }, NOW);
    expect(r).toEqual({ deleted: 2, remaining: 2 });
    expect(fetchedTimes(FIXTURE_TAG)).toEqual([daysAgo(200, 5)]);
    expect(fetchedTimes(OTHER_TAG)).toEqual([daysAgo(500)]);
    expect(getLatestSnapshot(OTHER_TAG)?.fetchedAt).toBe(daysAgo(500));
  });

  test("groups days per player, not globally", () => {
    snap(FIXTURE_TAG, daysAgo(20, 8));
    snap(OTHER_TAG, daysAgo(20, 9));
    snap(FIXTURE_TAG, hoursAgo(1));
    snap(OTHER_TAG, hoursAgo(1));
    expect(pruneSnapshots({ keepAllDays: 7, keepDailyDays: 90 }, NOW).deleted).toBe(0);
  });

  test("a daily window shorter than the keep-all window keeps the keep-all window", () => {
    snap(FIXTURE_TAG, hoursAgo(1));
    snap(FIXTURE_TAG, daysAgo(5, 3));
    snap(FIXTURE_TAG, daysAgo(5, 4));
    snap(FIXTURE_TAG, daysAgo(10));
    const r = pruneSnapshots({ keepAllDays: 7, keepDailyDays: 2 }, NOW);
    expect(r).toEqual({ deleted: 1, remaining: 3 });
  });

  test("is idempotent", () => {
    snap(FIXTURE_TAG, hoursAgo(1));
    for (const hour of [0, 12]) snap(FIXTURE_TAG, daysAgo(40, hour));
    expect(pruneSnapshots({ keepAllDays: 7, keepDailyDays: 90 }, NOW).deleted).toBe(1);
    expect(pruneSnapshots({ keepAllDays: 7, keepDailyDays: 90 }, NOW).deleted).toBe(0);
  });
});
