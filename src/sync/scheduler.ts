import { Cron } from "croner";
import { config } from "../config";
import type { CrApi } from "../cr/client";
import { purgeExpiredSessions } from "../auth/sessions";
import { countCards } from "../repos/cards";
import { type SyncAllResult, syncAll } from "./syncAll";
import { pruneSnapshots } from "./retention";
import { syncCards } from "./syncCards";

const DAILY_CRON = "17 4 * * *";

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Retries the card catalog when it is empty (a failed startup sync would otherwise leave deck
 * validation broken for everyone until the daily job), then syncs every player.
 */
export async function runSyncJob(client: CrApi, opts: { delayMs?: number } = {}): Promise<SyncAllResult> {
  if (countCards() === 0) {
    await syncCards(client).catch((err: unknown) => console.error(`[scheduler] card catalog retry failed: ${errText(err)}`));
  }
  const started = Date.now();
  const r = await syncAll(client, opts);
  console.log(
    `[scheduler] synced ${r.players} players (${r.failed} failed, ${r.skipped} skipped, ${r.battlesAdded} battles, ${r.snapshotsInserted} changed snapshots)` +
      `${r.rateLimited ? " [rate limited]" : ""} in ${Date.now() - started}ms`,
  );
  return r;
}

/** Each step is independent so an upstream outage can't stop retention or the session purge. */
export async function runDailyJob(client: CrApi): Promise<{ cards: number | null; purged: number; pruned: number }> {
  const pruned = pruneSnapshots().deleted;
  let cards: number | null = null;
  try {
    cards = await syncCards(client);
  } catch (err) {
    console.error(`[scheduler] card catalog refresh failed: ${errText(err)}`);
  }
  const purged = purgeExpiredSessions();
  console.log(
    `[scheduler] card catalog ${cards === null ? "refresh failed" : `refreshed (${cards})`}, ` +
      `purged ${purged} expired sessions, pruned ${pruned} snapshots`,
  );
  return { cards, purged, pruned };
}

/**
 * In-process jobs. `protect` makes croner skip a tick while the previous run is still going,
 * so a slow sync can't overlap itself. Only start this in one process per database.
 */
export function startScheduler(client: CrApi): { stop(): void } {
  const onError = (name: string) => (err: unknown) => console.error(`[scheduler] ${name} failed:`, err);

  const players = new Cron(
    config.SYNC_CRON,
    { name: "sync-players", protect: true, catch: onError("sync-players") },
    async () => {
      await runSyncJob(client);
    },
  );

  const daily = new Cron(
    DAILY_CRON,
    { name: "daily-maintenance", protect: true, catch: onError("daily-maintenance") },
    async () => {
      await runDailyJob(client);
    },
  );

  console.log(
    `[scheduler] started: players "${config.SYNC_CRON}" (next ${players.nextRun()?.toISOString()}), maintenance "${DAILY_CRON}"`,
  );

  return {
    stop() {
      players.stop();
      daily.stop();
    },
  };
}
