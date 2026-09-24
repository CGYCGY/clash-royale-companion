import { config } from "../config";
import { getBattleStats, listBattles } from "../repos/battles";
import { listCards } from "../repos/cards";
import { listDecks } from "../repos/decks";
import { getNotes } from "../repos/notes";
import { getLatestSnapshot, type PlayerRecord } from "../repos/players";
import { buildCollection } from "./collection";
import { renderContextMarkdown } from "./context";

/** Loads everything the AI context document needs for `player`; decks are the owner's. */
export function playerContextMarkdown(player: PlayerRecord): string {
  const snapshot = getLatestSnapshot(player.tag);
  return renderContextMarkdown({
    player,
    snapshot,
    stats7: getBattleStats(player.tag, { sinceDays: 7 }),
    stats30: getBattleStats(player.tag, { sinceDays: 30 }),
    recentBattles: listBattles(player.tag, { limit: 15 }),
    collection: buildCollection(snapshot?.player ?? null, listCards()),
    notes: getNotes(player.tag)?.content ?? null,
    decks: listDecks(player.userId),
    appUrl: config.APP_URL,
  });
}
