import { config } from "../config";
import { type CrApi, getCrClient } from "../cr/client";
import { getPlayer, type PlayerRecord } from "../repos/players";
import { getLastSyncRun } from "../repos/syncRuns";
import { notFound } from "../errors";
import { syncPlayer } from "./syncPlayer";

export type ManualSyncResult =
  | { ok: true; battlesAdded: number }
  | { ok: false; retryAfterSeconds: number }
  | { ok: false; error: string };

/**
 * Seconds until manualSync would accept a request for `player`. The cooldown counts from the most
 * recent sync attempt (scheduled or manual, including failed or in-flight ones), falling back to
 * last_synced_at, so errors can't be used to hammer the API.
 */
export function syncCooldownRemaining(player: Pick<PlayerRecord, "tag" | "lastSyncedAt">, now: Date = new Date()): number {
  const last = getLastSyncRun(player.tag)?.startedAt ?? player.lastSyncedAt;
  if (!last) return 0;
  return Math.max(0, Math.ceil(config.SYNC_COOLDOWN_SECONDS - (now.getTime() - Date.parse(last)) / 1000));
}

/**
 * User-triggered sync with a per-player cooldown of SYNC_COOLDOWN_SECONDS (see syncCooldownRemaining).
 * Caller must check ownership first (assertPlayerOwnedBy).
 */
export async function manualSync(
  tag: string,
  client: CrApi = getCrClient(),
  now: Date = new Date(),
): Promise<ManualSyncResult> {
  const player = getPlayer(tag);
  if (!player) throw notFound("Player");
  const remaining = syncCooldownRemaining(player, now);
  if (remaining > 0) return { ok: false, retryAfterSeconds: remaining };
  const r = await syncPlayer(tag, client);
  return r.error ? { ok: false, error: r.error } : { ok: true, battlesAdded: r.battlesAdded };
}
