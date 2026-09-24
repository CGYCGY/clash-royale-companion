import { getDb } from "../db";
import { nowIso } from "../util";

export type SyncStatus = "running" | "ok" | "error";

export interface SyncRunRecord {
  id: number;
  playerTag: string;
  startedAt: string;
  finishedAt: string | null;
  status: SyncStatus;
  battlesAdded: number;
  error: string | null;
}

interface SyncRunRow {
  id: number;
  player_tag: string;
  started_at: string;
  finished_at: string | null;
  status: SyncStatus;
  battles_added: number;
  error: string | null;
}

const toRecord = (r: SyncRunRow): SyncRunRecord => ({
  id: r.id,
  playerTag: r.player_tag,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  battlesAdded: r.battles_added,
  error: r.error,
});

export function startSyncRun(tag: string, now: Date = new Date()): number {
  return getDb()
    .query<{ id: number }, [string, string]>(
      "INSERT INTO sync_runs (player_tag, started_at) VALUES (?, ?) RETURNING id",
    )
    .get(tag, nowIso(now))!.id;
}

export function finishSyncRun(
  id: number,
  result: { status: "ok" | "error"; battlesAdded?: number; error?: string | null },
): void {
  getDb()
    .query("UPDATE sync_runs SET finished_at = ?, status = ?, battles_added = ?, error = ? WHERE id = ?")
    .run(nowIso(), result.status, result.battlesAdded ?? 0, result.error ?? null, id);
}

export function listRecentSyncRuns({ tag, limit = 20 }: { tag?: string; limit?: number } = {}): SyncRunRecord[] {
  const db = getDb();
  const rows = tag
    ? db
        .query<SyncRunRow, [string, number]>(
          "SELECT * FROM sync_runs WHERE player_tag = ? ORDER BY started_at DESC, id DESC LIMIT ?",
        )
        .all(tag, limit)
    : db
        .query<SyncRunRow, [number]>("SELECT * FROM sync_runs ORDER BY started_at DESC, id DESC LIMIT ?")
        .all(limit);
  return rows.map(toRecord);
}

export function getLastSyncRun(tag: string): SyncRunRecord | null {
  return listRecentSyncRuns({ tag, limit: 1 })[0] ?? null;
}
