import type { CrApi } from "../cr/client";
import { getPlayer, listAllPlayers } from "../repos/players";
import { sleep } from "../util";
import { syncPlayer } from "./syncPlayer";

export interface SyncAllResult {
  players: number;
  failed: number;
  /** Not attempted: removed mid-run, or left over after a rate limit stopped the run. */
  skipped: number;
  battlesAdded: number;
  snapshotsInserted: number;
  rateLimited: boolean;
}

/**
 * Sequential with a pause between players to stay well under the API rate limit. A 429 ends the
 * run, since every further request would just extend the throttle.
 */
export async function syncAll(client: CrApi, { delayMs = 300 }: { delayMs?: number } = {}): Promise<SyncAllResult> {
  const players = listAllPlayers();
  const summary: SyncAllResult = { players: players.length, failed: 0, skipped: 0, battlesAdded: 0, snapshotsInserted: 0, rateLimited: false };
  for (const [i, p] of players.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    // The list is read once up front and users can remove players during the run's awaits.
    if (!getPlayer(p.tag)) {
      summary.skipped++;
      continue;
    }
    try {
      const r = await syncPlayer(p.tag, client);
      summary.battlesAdded += r.battlesAdded;
      if (r.snapshotInserted) summary.snapshotsInserted++;
      if (r.error) {
        summary.failed++;
        console.warn(`[sync] ${p.tag}: ${r.error}`);
      }
      if (r.errorStatus === 429) {
        const rest = players.slice(i + 1).map((x) => x.tag);
        summary.skipped += rest.length;
        summary.rateLimited = true;
        const retry = r.retryAfterSeconds === undefined ? "" : ` (retry after ${r.retryAfterSeconds}s)`;
        console.warn(`[sync] rate limited${retry}; stopping run, skipped ${rest.length}: ${rest.join(", ") || "none"}`);
        break;
      }
    } catch (err) {
      summary.failed++;
      console.error(`[sync] ${p.tag}: unexpected error, continuing:`, err);
    }
  }
  return summary;
}
