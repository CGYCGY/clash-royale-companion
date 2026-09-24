import { config } from "../config";
import { type CrApi, getCrClient } from "../cr/client";
import { getPlayer } from "../repos/players";
import { getLastSyncRun } from "../repos/syncRuns";
import { notFound } from "../errors";
import { syncPlayer } from "./syncPlayer";

export type ManualSyncResult =
  | { ok: true; battlesAdded: number }
  | { ok: false; retryAfterSeconds: number }
  | { ok: false; error: string };

/**
 * User-triggered sync with a per-player cooldown of SYNC_COOLDOWN_SECONDS. The cooldown counts
 * from the most recent sync attempt (scheduled or manual, including failed or in-flight ones),
 * falling back to last_synced_at, so errors can't be used to hammer the API.
 * Caller must check ownership first (assertPlayerOwnedBy).
 */
export async function manualSync(
  tag: string,
  client: CrApi = getCrClient(),
  now: Date = new Date(),
): Promise<ManualSyncResult> {
  const player = getPlayer(tag);
  if (!player) throw notFound("Player");
  const last = getLastSyncRun(tag)?.startedAt ?? player.lastSyncedAt;
  if (last) {
    const elapsed = (now.getTime() - Date.parse(last)) / 1000;
    const remaining = Math.ceil(config.SYNC_COOLDOWN_SECONDS - elapsed);
    if (remaining > 0) return { ok: false, retryAfterSeconds: remaining };
  }
  const r = await syncPlayer(tag, client);
  return r.error ? { ok: false, error: r.error } : { ok: true, battlesAdded: r.battlesAdded };
}
