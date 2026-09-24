import { config } from "../config";
import { getDb } from "../db";
import { daysAgoIso } from "../util";

export interface RetentionPolicy {
  keepAllDays: number;
  keepDailyDays: number;
}

export interface PruneResult {
  deleted: number;
  remaining: number;
}

/**
 * Thins player_snapshots: everything newer than keepAllDays stays, then only the last snapshot of
 * each UTC day until keepDailyDays, then nothing. The newest snapshot per player always survives
 * so the profile and context still render for players whose sync has been failing for months.
 * Trophy history reads snapshots, so this lowers its resolution for old data rather than losing it.
 */
export function pruneSnapshots(
  {
    keepAllDays = config.SNAPSHOT_KEEP_ALL_DAYS,
    keepDailyDays = config.SNAPSHOT_KEEP_DAILY_DAYS,
  }: Partial<RetentionPolicy> = {},
  now: Date = new Date(),
): PruneResult {
  const allCutoff = daysAgoIso(keepAllDays, now);
  // A daily window shorter than the keep-all window would mean "no daily tier", not "delete recent data".
  const dailyCutoff = daysAgoIso(Math.max(keepDailyDays, keepAllDays), now);
  const db = getDb();
  // fetched_at is ISO 8601 UTC, so its first 10 chars are the UTC day.
  const deleted = db
    .query(
      `DELETE FROM player_snapshots WHERE id IN (
         SELECT id FROM (
           SELECT id, fetched_at,
                  ROW_NUMBER() OVER (PARTITION BY player_tag ORDER BY fetched_at DESC, id DESC) AS player_rank,
                  ROW_NUMBER() OVER (PARTITION BY player_tag, substr(fetched_at, 1, 10)
                                     ORDER BY fetched_at DESC, id DESC) AS day_rank
           FROM player_snapshots
         )
         WHERE player_rank > 1
           AND fetched_at < $allCutoff
           AND (fetched_at < $dailyCutoff OR day_rank > 1)
       )`,
    )
    .run({ allCutoff, dailyCutoff }).changes;
  const remaining = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM player_snapshots").get()!.n;
  return { deleted, remaining };
}
