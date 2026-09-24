import { displayLevel } from "../cr/levels";
import type { BattleCard, BattleLogEntry, BattleParticipant } from "../cr/types";
import { parseBattleTime } from "../cr/types";
import { getDb } from "../db";
import { daysAgoIso, ratio } from "../util";
import { type CardRecord, cardsById, cardsMap } from "./cards";

export type BattleResult = "win" | "loss" | "draw";

export interface DeckCard {
  id: number;
  name: string;
  /** In-game display level (1–16 scale), already converted from the API's rarity-relative level. */
  level: number;
  /** 0 when the card was not played evolved. */
  evolutionLevel: number;
}

export interface BattleRecord {
  id: number;
  playerTag: string;
  battleTime: string;
  type: string;
  gameModeName: string;
  arenaName: string | null;
  opponentTag: string;
  /** For 2v2, both opponents joined with " & ". */
  opponentName: string;
  result: BattleResult;
  teamCrowns: number;
  opponentCrowns: number;
  /** Tracked player's 8 cards first; for 2v2 the teammate's 8 follow. */
  teamDeck: DeckCard[];
  opponentDeck: DeckCard[];
  /** Sorted names of the tracked player's own 8 cards joined with "|"; groups battles by deck. */
  deckKey: string;
  trophyChange: number | null;
  isTwoVsTwo: boolean;
}

interface BattleRow {
  id: number;
  player_tag: string;
  battle_time: string;
  type: string;
  game_mode_name: string;
  arena_name: string | null;
  opponent_tag: string;
  opponent_name: string;
  result: BattleResult;
  team_crowns: number;
  opponent_crowns: number;
  team_deck: string;
  opponent_deck: string;
  deck_key: string;
  trophy_change: number | null;
  team_size: number;
  data?: string;
}

const LIST_COLUMNS =
  "id, player_tag, battle_time, type, game_mode_name, arena_name, opponent_tag, opponent_name, result, team_crowns, opponent_crowns, team_deck, opponent_deck, deck_key, trophy_change, team_size";

function toRecord(r: BattleRow): BattleRecord {
  const teamDeck = JSON.parse(r.team_deck) as DeckCard[];
  return {
    id: r.id,
    playerTag: r.player_tag,
    battleTime: r.battle_time,
    type: r.type,
    gameModeName: r.game_mode_name,
    arenaName: r.arena_name,
    opponentTag: r.opponent_tag,
    opponentName: r.opponent_name,
    result: r.result,
    teamCrowns: r.team_crowns,
    opponentCrowns: r.opponent_crowns,
    teamDeck,
    opponentDeck: JSON.parse(r.opponent_deck) as DeckCard[],
    deckKey: r.deck_key,
    trophyChange: r.trophy_change,
    isTwoVsTwo: r.team_size > 1,
  };
}

export const deckKeyOf = (names: string[]): string => [...names].sort().join("|");

/** `won` overrides crowns for modes that report the outcome separately (boat battles are always 0-0). */
export function computeResult(teamCrowns: number, opponentCrowns: number, won?: boolean): BattleResult {
  if (typeof won === "boolean") return won ? "win" : "loss";
  if (teamCrowns > opponentCrowns) return "win";
  if (teamCrowns < opponentCrowns) return "loss";
  return "draw";
}

function toDeckCard(card: BattleCard, catalog: Map<number, CardRecord>): DeckCard {
  // Battle-log cards sometimes omit rarity; the catalog fills the gap for the level conversion.
  const rarity = card.rarity ?? catalog.get(card.id)?.rarity;
  return {
    id: card.id,
    name: card.name,
    level: displayLevel(card.level, rarity),
    evolutionLevel: card.evolutionLevel ?? 0,
  };
}

/** Pure transform from an API battle-log entry to column values. Exported for tests. */
export function battleToRow(tag: string, entry: BattleLogEntry, catalog: Map<number, CardRecord>) {
  // The API lists the requesting player first, but match on tag to be safe.
  const me: BattleParticipant | undefined = entry.team.find((p) => p.tag === tag) ?? entry.team[0];
  if (!me) throw new Error(`Battle at ${entry.battleTime} has no team participants`);
  const teammates = entry.team.filter((p) => p !== me);
  const opp = entry.opponent;
  const teamCrowns = me.crowns;
  const opponentCrowns = opp[0]?.crowns ?? 0;
  // Some modes omit `cards` for a participant; treat that as an empty deck rather than failing the entry.
  const deckOf = (p: BattleParticipant) => (p.cards ?? []).map((c) => toDeckCard(c, catalog));
  const ownCards = deckOf(me);
  const teamDeck = [...ownCards, ...teammates.flatMap(deckOf)];
  const opponentDeck = opp.flatMap(deckOf);
  return {
    player_tag: tag,
    battle_time: parseBattleTime(entry.battleTime),
    type: entry.type,
    game_mode_name: entry.gameMode?.name ?? entry.type,
    arena_name: entry.arena?.name ?? null,
    opponent_tag: opp[0]?.tag ?? "",
    opponent_name: opp.map((p) => p.name).join(" & "),
    result: computeResult(teamCrowns, opponentCrowns, entry.boatBattleWon),
    team_crowns: teamCrowns,
    opponent_crowns: opponentCrowns,
    team_deck: JSON.stringify(teamDeck),
    opponent_deck: JSON.stringify(opponentDeck),
    deck_key: deckKeyOf(ownCards.map((c) => c.name)),
    trophy_change: me.trophyChange ?? null,
    team_size: entry.team.length,
    data: JSON.stringify(entry),
  };
}

/**
 * Inserts new battles, ignoring ones already stored. Returns the number actually added. A malformed
 * entry is logged and skipped so it can't roll back the rest of the log (or the caller's snapshot).
 */
export function insertBattles(tag: string, entries: BattleLogEntry[]): number {
  const db = getDb();
  const catalog = cardsById();
  const stmt = db.query(
    `INSERT OR IGNORE INTO battles (player_tag, battle_time, type, game_mode_name, arena_name, opponent_tag,
       opponent_name, result, team_crowns, opponent_crowns, team_deck, opponent_deck, deck_key, trophy_change,
       team_size, data)
     VALUES ($player_tag, $battle_time, $type, $game_mode_name, $arena_name, $opponent_tag, $opponent_name,
       $result, $team_crowns, $opponent_crowns, $team_deck, $opponent_deck, $deck_key, $trophy_change,
       $team_size, $data)`,
  );
  let added = 0;
  db.transaction(() => {
    for (const entry of entries) {
      try {
        added += stmt.run(battleToRow(tag, entry, catalog)).changes;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[battles] skipped malformed battle for ${tag} at ${entry?.battleTime ?? "unknown time"}: ${msg}`);
      }
    }
  })();
  return added;
}

export interface BattleFilter {
  /** ISO timestamps, inclusive `since`, exclusive `until`. */
  since?: string;
  until?: string;
  /** Matches either the battle `type` (e.g. "pathOfLegend") or `gameModeName` (e.g. "Ladder"). */
  mode?: string;
  result?: BattleResult;
}

function whereClause(tag: string, f: BattleFilter): { sql: string; params: (string | number)[] } {
  const parts = ["player_tag = ?"];
  const params: (string | number)[] = [tag];
  if (f.since) {
    parts.push("battle_time >= ?");
    params.push(f.since);
  }
  if (f.until) {
    parts.push("battle_time < ?");
    params.push(f.until);
  }
  if (f.mode) {
    parts.push("(type = ? OR game_mode_name = ?)");
    params.push(f.mode, f.mode);
  }
  if (f.result) {
    parts.push("result = ?");
    params.push(f.result);
  }
  return { sql: parts.join(" AND "), params };
}

/** Newest first. `limit` defaults to 50 and is capped at 500. */
export function listBattles(
  tag: string,
  opts: BattleFilter & { limit?: number; offset?: number } = {},
): BattleRecord[] {
  const { sql, params } = whereClause(tag, opts);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  return getDb()
    .query<BattleRow, (string | number)[]>(
      `SELECT ${LIST_COLUMNS} FROM battles WHERE ${sql} ORDER BY battle_time DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, opts.offset ?? 0)
    .map(toRecord);
}

export function countBattles(tag: string, filter: BattleFilter = {}): number {
  const { sql, params } = whereClause(tag, filter);
  return getDb()
    .query<{ n: number }, (string | number)[]>(`SELECT COUNT(*) AS n FROM battles WHERE ${sql}`)
    .get(...params)!.n;
}

/** One battle including the raw API entry. Scoped by player tag so ids can't cross owners. */
export function getBattle(tag: string, id: number): (BattleRecord & { raw: BattleLogEntry }) | null {
  const row = getDb()
    .query<BattleRow, [string, number]>(`SELECT ${LIST_COLUMNS}, data FROM battles WHERE player_tag = ? AND id = ?`)
    .get(tag, id);
  if (!row) return null;
  return { ...toRecord(row), raw: JSON.parse(row.data!) as BattleLogEntry };
}

export interface Tally {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** wins / games, 0..1 rounded to 3 decimals; draws count as games. */
  winRate: number;
}

export interface BattleStats {
  sinceDays: number | null;
  total: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  /** Sum of trophy changes over battles that report one (ladder). */
  netTrophies: number;
  byMode: (Tally & { type: string; mode: string })[];
  /** Most games first. `lastPlayed` is the newest battle_time with the deck. */
  byDeck: (Tally & { deckKey: string; cards: string[]; avgElixir: number | null; lastPlayed: string })[];
}

interface TallyRow {
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

const TALLY_SQL =
  "COUNT(*) AS games, SUM(result = 'win') AS wins, SUM(result = 'loss') AS losses, SUM(result = 'draw') AS draws";

const tally = (r: TallyRow): Tally => ({
  games: r.games,
  wins: r.wins ?? 0,
  losses: r.losses ?? 0,
  draws: r.draws ?? 0,
  winRate: ratio(r.wins ?? 0, r.games),
});

/** avgElixir is null when any card lacks a known cost (not in catalog, or variable like Mirror). */
export function averageElixir(names: string[], catalog: Map<string, CardRecord>): number | null {
  let sum = 0;
  for (const name of names) {
    const cost = catalog.get(name)?.elixirCost;
    if (cost == null) return null;
    sum += cost;
  }
  return names.length ? Math.round((sum / names.length) * 100) / 100 : null;
}

/** `mode` narrows every tally with the same rule as listBattles' filter. */
export function getBattleStats(tag: string, { sinceDays, mode }: { sinceDays?: number; mode?: string } = {}): BattleStats {
  const db = getDb();
  const { sql, params } = whereClause(tag, { since: sinceDays === undefined ? undefined : daysAgoIso(sinceDays), mode });
  const totals = db
    .query<TallyRow & { net: number | null }, (string | number)[]>(
      `SELECT ${TALLY_SQL}, SUM(trophy_change) AS net FROM battles WHERE ${sql}`,
    )
    .get(...params)!;
  const byMode = db
    .query<TallyRow & { type: string; mode: string }, (string | number)[]>(
      `SELECT type, game_mode_name AS mode, ${TALLY_SQL} FROM battles
       WHERE ${sql} GROUP BY type, game_mode_name ORDER BY games DESC, mode`,
    )
    .all(...params);
  const byDeck = db
    .query<TallyRow & { deck_key: string; last_played: string }, (string | number)[]>(
      `SELECT deck_key, MAX(battle_time) AS last_played, ${TALLY_SQL} FROM battles
       WHERE ${sql} GROUP BY deck_key ORDER BY games DESC, deck_key`,
    )
    .all(...params);
  const catalog = cardsMap();
  const t = tally(totals);
  return {
    sinceDays: sinceDays ?? null,
    total: t.games,
    wins: t.wins,
    losses: t.losses,
    draws: t.draws,
    winRate: t.winRate,
    netTrophies: totals.net ?? 0,
    byMode: byMode.map((r) => ({ type: r.type, mode: r.mode, ...tally(r) })),
    byDeck: byDeck.map((r) => {
      const cards = r.deck_key ? r.deck_key.split("|") : [];
      return {
        deckKey: r.deck_key,
        cards,
        avgElixir: averageElixir(cards, catalog),
        lastPlayed: r.last_played,
        ...tally(r),
      };
    }),
  };
}
