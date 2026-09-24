import type { Player } from "../cr/types";
import { getDb } from "../db";
import { AppError, notFound } from "../errors";
import { daysAgoIso, nowIso } from "../util";

export interface PlayerRecord {
  /** Normalized, e.g. "#9QJUGC2R". */
  tag: string;
  userId: number;
  name: string;
  addedAt: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

interface PlayerRow {
  tag: string;
  user_id: number;
  name: string;
  added_at: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

const toRecord = (r: PlayerRow): PlayerRecord => ({
  tag: r.tag,
  userId: r.user_id,
  name: r.name,
  addedAt: r.added_at,
  lastSyncedAt: r.last_synced_at,
  lastSyncError: r.last_sync_error,
});

/** Throws AppError("conflict") if any user already tracks `tag` (a tag has exactly one owner). */
export function assertTagAvailable(tag: string, userId: number): void {
  const existing = getPlayer(tag);
  if (existing) {
    throw new AppError(
      "conflict",
      existing.userId === userId ? `You already track ${tag}` : `${tag} is already tracked by another account`,
      409,
    );
  }
}

/** `tag` must already be normalized. Throws AppError("conflict") if any user already tracks it. */
export function addPlayer(userId: number, tag: string, name = ""): PlayerRecord {
  assertTagAvailable(tag, userId);
  const row = getDb()
    .query<PlayerRow, [string, number, string, string]>(
      "INSERT INTO players (tag, user_id, name, added_at) VALUES (?, ?, ?, ?) RETURNING *",
    )
    .get(tag, userId, name, nowIso())!;
  return toRecord(row);
}

/** Deletes the player and (via cascade) its snapshots, battles, notes, and sync runs. Owner-scoped. */
export function removePlayer(tag: string, userId: number): boolean {
  return getDb().query("DELETE FROM players WHERE tag = ? AND user_id = ?").run(tag, userId).changes > 0;
}

export function listPlayersForUser(userId: number): PlayerRecord[] {
  return getDb()
    .query<PlayerRow, [number]>("SELECT * FROM players WHERE user_id = ? ORDER BY added_at")
    .all(userId)
    .map(toRecord);
}

export function listAllPlayers(): PlayerRecord[] {
  return getDb().query<PlayerRow, []>("SELECT * FROM players ORDER BY added_at").all().map(toRecord);
}

export function getPlayer(tag: string): PlayerRecord | null {
  const row = getDb().query<PlayerRow, [string]>("SELECT * FROM players WHERE tag = ?").get(tag);
  return row ? toRecord(row) : null;
}

/**
 * Returns the player if `userId` owns it. Throws 404 (not 403) otherwise so callers can't probe
 * which tags other users track.
 */
export function assertPlayerOwnedBy(tag: string, userId: number): PlayerRecord {
  const player = getPlayer(tag);
  if (!player || player.userId !== userId) throw notFound("Player");
  return player;
}

/** On success stamps last_synced_at, clears the error, and refreshes the name if given. */
export function setSyncResult(
  tag: string,
  result: { ok: true; name?: string } | { ok: false; error: string },
  now: Date = new Date(),
): void {
  const db = getDb();
  if (result.ok) {
    db.query(
      "UPDATE players SET last_synced_at = ?, last_sync_error = NULL, name = COALESCE(?, name) WHERE tag = ?",
    ).run(nowIso(now), result.name ?? null, tag);
  } else {
    db.query("UPDATE players SET last_sync_error = ? WHERE tag = ?").run(result.error, tag);
  }
}

export interface Snapshot {
  player: Player;
  /** When this exact state was first observed. */
  fetchedAt: string;
  /** The most recent sync that returned this same state; use this for "synced at" / snapshot age. */
  lastSeenAt: string;
}

/**
 * Stores a snapshot unless its data is byte-identical to the player's newest one, in which case
 * only that row's last_seen_at advances. The official payloads carry no per-request fields
 * (timestamps, request ids), so an idle player serializes identically between syncs.
 * The legacy `chests` column is ignored here and left NULL on new rows: comparing it would make
 * the first sync after chests were dropped store a duplicate of an older row that still has them.
 */
export function insertSnapshot(
  tag: string,
  player: Player,
  fetchedAt: string = nowIso(),
): { inserted: boolean; id: number } {
  const db = getDb();
  const data = JSON.stringify(player);
  const latest = db
    .query<{ id: number; data: string }, [string]>(
      "SELECT id, data FROM player_snapshots WHERE player_tag = ? ORDER BY fetched_at DESC, id DESC LIMIT 1",
    )
    .get(tag);
  if (latest && latest.data === data) {
    // MAX keeps last_seen_at from moving backwards if an older fetch is recorded late.
    db.query("UPDATE player_snapshots SET last_seen_at = MAX(COALESCE(last_seen_at, fetched_at), ?) WHERE id = ?").run(
      fetchedAt,
      latest.id,
    );
    return { inserted: false, id: latest.id };
  }
  const row = db
    .query<{ id: number }, [string, string, string, string]>(
      "INSERT INTO player_snapshots (player_tag, fetched_at, last_seen_at, data) VALUES (?, ?, ?, ?) RETURNING id",
    )
    .get(tag, fetchedAt, fetchedAt, data)!;
  return { inserted: true, id: row.id };
}

export function getLatestSnapshot(tag: string): Snapshot | null {
  const row = getDb()
    .query<{ data: string; fetched_at: string; last_seen_at: string | null }, [string]>(
      "SELECT data, fetched_at, last_seen_at FROM player_snapshots WHERE player_tag = ? ORDER BY fetched_at DESC, id DESC LIMIT 1",
    )
    .get(tag);
  if (!row) return null;
  return {
    player: JSON.parse(row.data) as Player,
    fetchedAt: row.fetched_at,
    lastSeenAt: row.last_seen_at ?? row.fetched_at,
  };
}

export interface TrophyPoint {
  fetchedAt: string;
  /** Last sync that still saw these values; with fetchedAt it bounds a plateau. */
  lastSeenAt: string;
  trophies: number;
  bestTrophies: number;
  /** Path of Legend current season trophies, null when not in a league. */
  polTrophies: number | null;
  polLeague: number | null;
}

/** Cheap time series from snapshots via json_extract (doesn't parse whole payloads in JS). */
export function getTrophyHistory(tag: string, { sinceDays }: { sinceDays?: number } = {}): TrophyPoint[] {
  const since = sinceDays === undefined ? "" : daysAgoIso(sinceDays);
  return getDb()
    .query<
      {
        fetched_at: string;
        last_seen_at: string | null;
        trophies: number;
        best_trophies: number;
        pol_trophies: number | null;
        pol_league: number | null;
      },
      [string, string]
    >(
      `SELECT fetched_at, last_seen_at,
              json_extract(data, '$.trophies') AS trophies,
              json_extract(data, '$.bestTrophies') AS best_trophies,
              json_extract(data, '$.currentPathOfLegendSeasonResult.trophies') AS pol_trophies,
              json_extract(data, '$.currentPathOfLegendSeasonResult.leagueNumber') AS pol_league
       FROM player_snapshots WHERE player_tag = ? AND fetched_at >= ? ORDER BY fetched_at`,
    )
    .all(tag, since)
    .map((r) => ({
      fetchedAt: r.fetched_at,
      lastSeenAt: r.last_seen_at ?? r.fetched_at,
      trophies: r.trophies,
      bestTrophies: r.best_trophies,
      polTrophies: r.pol_trophies,
      polLeague: r.pol_league,
    }));
}
