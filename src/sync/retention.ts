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
 * Opt-in thinning of player_snapshots; with both windows at 0 (the default) nothing is deleted.
 * keepAllDays > 0: rows older than that are thinned to the last snapshot of each UTC day.
 * keepDailyDays > 0: rows older than that are deleted. A 0 for either disables that tier.
 * The newest snapshot per player always survives so the profile and context still render for
 * players whose sync has been failing for months. Trophy history reads snapshots, so thinning
 * lowers its resolution for old data.
 */
export function pruneSnapshots(
  {
    keepAllDays = config.SNAPSHOT_KEEP_ALL_DAYS,
    keepDailyDays = config.SNAPSHOT_KEEP_DAILY_DAYS,
  }: Partial<RetentionPolicy> = {},
  now: Date = new Date(),
): PruneResult {
  const db = getDb();
  const count = () => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM player_snapshots").get()!.n;
  if (keepAllDays <= 0 && keepDailyDays <= 0) return { deleted: 0, remaining: count() };
  // "" sorts before every timestamp, so a disabled daily tier deletes nothing by age; a disabled
  // keep-all tier reuses the daily cutoff, which leaves only the age rule.
  // A daily window shorter than the keep-all window would mean "no daily tier", not "delete recent data".
  const dailyCutoff = keepDailyDays > 0 ? daysAgoIso(Math.max(keepDailyDays, keepAllDays), now) : "";
  const allCutoff = keepAllDays > 0 ? daysAgoIso(keepAllDays, now) : dailyCutoff;
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
  return { deleted, remaining: count() };
}
