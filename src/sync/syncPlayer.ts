import { CrApiError, type CrApi } from "../cr/client";
import type { UpcomingChests } from "../cr/types";
import { getDb } from "../db";
import { insertBattles } from "../repos/battles";
import { insertSnapshot, setSyncResult } from "../repos/players";
import { finishSyncRun, startSyncRun } from "../repos/syncRuns";

export interface SyncResult {
  battlesAdded: number;
  error?: string;
  /** Upstream HTTP status when the failure came from the CR API (0 for network errors). */
  errorStatus?: number;
  retryAfterSeconds?: number;
}

const errorMessage = (err: unknown): string =>
  err instanceof CrApiError || err instanceof Error ? err.message : String(err);

/**
 * Fetches player + battle log (+ chests, best effort), stores a snapshot and new battles, and
 * records a sync_run. Never throws for API/data errors; they're returned and recorded.
 * The sync_run row is inserted before the first await, which manualSync relies on for its
 * cooldown check to be race-free. The player must already exist in `players`.
 */
export async function syncPlayer(tag: string, client: CrApi): Promise<SyncResult> {
  const runId = startSyncRun(tag);
  try {
    const [player, battleLog, chests] = await Promise.all([
      client.getPlayer(tag),
      client.getPlayerBattleLog(tag),
      // Chests are cosmetic and the endpoint has been flaky/deprecated; don't fail the sync over it.
      client.getUpcomingChests(tag).catch((): UpcomingChests | null => null),
    ]);
    let battlesAdded = 0;
    getDb().transaction(() => {
      insertSnapshot(tag, player, chests);
      battlesAdded = insertBattles(tag, battleLog);
      setSyncResult(tag, { ok: true, name: player.name });
      finishSyncRun(runId, { status: "ok", battlesAdded });
    })();
    return { battlesAdded };
  } catch (err) {
    const error = errorMessage(err);
    try {
      setSyncResult(tag, { ok: false, error });
      finishSyncRun(runId, { status: "error", error });
    } catch (dbErr) {
      console.error(`[sync] failed to record error for ${tag}:`, dbErr);
    }
    const result: SyncResult = { battlesAdded: 0, error };
    if (err instanceof CrApiError) {
      result.errorStatus = err.status;
      if (err.retryAfterSeconds !== undefined) result.retryAfterSeconds = err.retryAfterSeconds;
    }
    return result;
  }
}
