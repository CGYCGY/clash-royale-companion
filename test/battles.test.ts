import { beforeEach, describe, expect, test } from "bun:test";
import type { BattleLogEntry } from "../src/cr/types";
import { countBattles, getBattle, getBattleStats, insertBattles, listBattles } from "../src/repos/battles";
import { addPlayer } from "../src/repos/players";
import { getDb, migrate, openDatabase } from "../src/db";
import { FIXTURE_TAG, loadFixture, makeTestDb, makeUser, seedCards } from "./helpers";

const fixtureLadder = (): BattleLogEntry => structuredClone(loadFixture<BattleLogEntry[]>("battlelog")[0]!);

const HOG = ["Cannon", "Fireball", "Hog Rider", "Ice Golem", "Ice Spirit", "Musketeer", "Skeletons", "The Log"].join("|");

beforeEach(() => {
  makeTestDb();
  seedCards();
  addPlayer(makeUser().id, FIXTURE_TAG);
  insertBattles(FIXTURE_TAG, loadFixture<BattleLogEntry[]>("battlelog"));
});

describe("insertBattles / listBattles", () => {
  test("stores normalized rows newest first", () => {
    const [latest] = listBattles(FIXTURE_TAG, { limit: 1 });
    expect(latest).toMatchObject({
      battleTime: "2026-09-24T10:15:00.000Z",
      type: "PvP",
      gameModeName: "Ladder",
      result: "win",
      teamCrowns: 3,
      opponentCrowns: 1,
      opponentTag: "#8LQ2R0YCP",
      trophyChange: 30,
      deckKey: HOG,
      isTwoVsTwo: false,
    });
    // Rare Hog Rider at API level 12 is displayed as 14.
    expect(latest!.teamDeck.find((c) => c.name === "Hog Rider")).toEqual({
      id: 26000021,
      name: "Hog Rider",
      level: 14,
      evolutionLevel: 0,
    });
    expect(latest!.teamDeck.find((c) => c.name === "Musketeer")!.evolutionLevel).toBe(1);
  });

  test("2v2 keeps both teammates' cards with the player's first", () => {
    const [duo] = listBattles(FIXTURE_TAG, { mode: "TeamVsTeam" });
    expect(duo!.isTwoVsTwo).toBe(true);
    expect(duo!.teamDeck).toHaveLength(16);
    expect(duo!.opponentDeck).toHaveLength(16);
    expect(duo!.teamDeck[0]!.name).toBe("Hog Rider");
    expect(duo!.deckKey).toBe(HOG);
    expect(duo!.opponentName).toBe("Duo One & Duo Two");
  });

  test("draws, filters, paging, and raw lookup", () => {
    expect(listBattles(FIXTURE_TAG, { result: "draw" }).map((b) => b.battleTime)).toEqual(["2026-09-24T09:00:00.000Z"]);
    expect(countBattles(FIXTURE_TAG, { mode: "pathOfLegend" })).toBe(3);
    expect(countBattles(FIXTURE_TAG, { since: "2026-09-24T00:00:00.000Z" })).toBe(5);
    expect(countBattles(FIXTURE_TAG, { until: "2026-09-24T00:00:00.000Z" })).toBe(5);
    const page2 = listBattles(FIXTURE_TAG, { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    expect(page2[0]!.battleTime).toBe("2026-09-24T09:25:00.000Z");
    const one = getBattle(FIXTURE_TAG, page2[0]!.id)!;
    expect(one.raw.gameMode.name).toBe("TeamVsTeam");
    expect(getBattle("#PYVJ98G2", page2[0]!.id)).toBeNull();
  });

  test("re-inserting is a no-op", () => {
    expect(insertBattles(FIXTURE_TAG, loadFixture<BattleLogEntry[]>("battlelog"))).toBe(0);
  });
});

describe("unusual battle entries", () => {
  test("boat battles take their result from boatBattleWon, not the 0-0 crowns", () => {
    const won = { ...fixtureLadder(), type: "boatBattle", battleTime: "20260920T100000.000Z", boatBattleWon: true };
    const lost = { ...fixtureLadder(), type: "boatBattle", battleTime: "20260920T110000.000Z", boatBattleWon: false };
    for (const b of [won, lost]) {
      b.team[0]!.crowns = 0;
      b.opponent[0]!.crowns = 0;
    }
    expect(insertBattles(FIXTURE_TAG, [won, lost])).toBe(2);
    const boats = listBattles(FIXTURE_TAG, { mode: "boatBattle" });
    expect(boats.map((b) => [b.result, b.teamCrowns, b.opponentCrowns])).toEqual([
      ["loss", 0, 0],
      ["win", 0, 0],
    ]);
  });

  test("a 1v1 with more than 8 cards is not flagged as 2v2", () => {
    const big = { ...fixtureLadder(), battleTime: "20260920T120000.000Z" };
    big.team[0]!.cards = [...big.team[0]!.cards, ...big.team[0]!.cards.slice(0, 2)];
    insertBattles(FIXTURE_TAG, [big]);
    const [row] = listBattles(FIXTURE_TAG, { until: "2026-09-20T12:00:01.000Z", since: "2026-09-20T12:00:00.000Z" });
    expect(row!.teamDeck).toHaveLength(10);
    expect(row!.isTwoVsTwo).toBe(false);
  });

  test("malformed entries are skipped without dropping the rest", () => {
    const noCards = { ...fixtureLadder(), battleTime: "20260920T130000.000Z" };
    delete (noCards.opponent[0] as { cards?: unknown }).cards;
    const badTime = { ...fixtureLadder(), battleTime: "yesterday" };
    const noTeam = { ...fixtureLadder(), battleTime: "20260920T140000.000Z", team: [] };
    const ok = { ...fixtureLadder(), battleTime: "20260920T150000.000Z" };
    expect(insertBattles(FIXTURE_TAG, [noCards, badTime, noTeam, ok])).toBe(2);
    expect(countBattles(FIXTURE_TAG)).toBe(12);
    const [stored] = listBattles(FIXTURE_TAG, { since: "2026-09-20T13:00:00.000Z", until: "2026-09-20T13:00:01.000Z" });
    expect(stored!.opponentDeck).toEqual([]);
  });

  test("migration 0002 backfills team_size from stored battle JSON", () => {
    const db = openDatabase(":memory:");
    db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    const fresh = getDb();
    // Apply only 0001 by pre-marking 0002, then un-mark it and migrate again.
    db.query("INSERT INTO schema_migrations VALUES ('0002_battles_team_size.sql', 'x')").run();
    migrate(db);
    db.query("DELETE FROM schema_migrations WHERE name = '0002_battles_team_size.sql'").run();
    db.query("INSERT INTO users (username, password_hash, created_at) VALUES ('u', 'h', 'x')").run();
    db.query("INSERT INTO players (tag, user_id, added_at) VALUES (?, 1, 'x')").run(FIXTURE_TAG);
    const rows = fresh.query<Record<string, unknown>, []>("SELECT * FROM battles").all();
    const insert = db.query(
      `INSERT INTO battles (player_tag, battle_time, type, game_mode_name, arena_name, opponent_tag, opponent_name, result,
         team_crowns, opponent_crowns, team_deck, opponent_deck, deck_key, trophy_change, data)
       VALUES ($player_tag, $battle_time, $type, $game_mode_name, $arena_name, $opponent_tag, $opponent_name, $result,
         $team_crowns, $opponent_crowns, $team_deck, $opponent_deck, $deck_key, $trophy_change, $data)`,
    );
    for (const { id: _id, team_size: _ts, ...r } of rows) insert.run(r as never);
    expect(migrate(db)).toEqual(["0002_battles_team_size.sql"]);
    const sizes = db
      .query<{ type: string; team_size: number }, []>("SELECT type, team_size FROM battles ORDER BY battle_time")
      .all();
    expect(sizes.filter((r) => r.team_size === 2).map((r) => r.type)).toEqual(["clanMate2v2"]);
    expect(sizes.filter((r) => r.team_size === 1)).toHaveLength(9);
  });
});

describe("getBattleStats", () => {
  test("totals, by mode, by deck", () => {
    const s = getBattleStats(FIXTURE_TAG);
    expect(s).toMatchObject({ sinceDays: null, total: 10, wins: 6, losses: 3, draws: 1, winRate: 0.6, netTrophies: 34 });
    expect(s.byMode).toEqual([
      { type: "PvP", mode: "Ladder", games: 5, wins: 3, losses: 2, draws: 0, winRate: 0.6 },
      { type: "pathOfLegend", mode: "Ranked1v1_NewArena2", games: 3, wins: 2, losses: 0, draws: 1, winRate: 0.667 },
      { type: "friendly", mode: "Friendly", games: 1, wins: 0, losses: 1, draws: 0, winRate: 0 },
      { type: "clanMate2v2", mode: "TeamVsTeam", games: 1, wins: 1, losses: 0, draws: 0, winRate: 1 },
    ]);
    expect(s.byDeck).toHaveLength(2);
    expect(s.byDeck[0]).toMatchObject({ deckKey: HOG, games: 8, wins: 5, losses: 2, draws: 1, winRate: 0.625, avgElixir: 2.63 });
    expect(s.byDeck[0]!.cards).toHaveLength(8);
    expect(s.byDeck[1]).toMatchObject({ games: 2, wins: 1, winRate: 0.5, avgElixir: 3.75 });
  });

  test("mode narrows totals, byMode, and byDeck like the list filter", () => {
    const pol = getBattleStats(FIXTURE_TAG, { mode: "pathOfLegend" });
    expect(pol).toMatchObject({ total: 3, wins: 2, losses: 0, draws: 1 });
    expect(pol.byMode.map((m) => m.type)).toEqual(["pathOfLegend"]);
    expect(pol.byDeck.reduce((n, d) => n + d.games, 0)).toBe(3);
    expect(getBattleStats(FIXTURE_TAG, { mode: "Ladder" }).total).toBe(countBattles(FIXTURE_TAG, { mode: "Ladder" }));
    expect(getBattleStats(FIXTURE_TAG, { mode: "nope" }).total).toBe(0);
  });

  test("sinceDays window and empty stats", () => {
    const s = getBattleStats(FIXTURE_TAG, { sinceDays: 0 });
    expect(s).toMatchObject({ sinceDays: 0, total: 0, wins: 0, winRate: 0, netTrophies: 0, byMode: [], byDeck: [] });
  });
});
