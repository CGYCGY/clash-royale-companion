import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { insertUser } from "../src/auth/users";
import { CrApiError, type CrApi } from "../src/cr/client";
import type { BattleLogEntry, CardsResponse, GameEvent, Player } from "../src/cr/types";
import { migrate, openDatabase, setDatabase } from "../src/db";
import { upsertCards } from "../src/repos/cards";
import type { User } from "../src/types";

/** Fresh in-memory DB with migrations applied, installed as the shared connection. Call in beforeEach. */
export function makeTestDb(): Database {
  const db = openDatabase(":memory:");
  migrate(db);
  setDatabase(db);
  return db;
}

export function loadFixture<T>(name: "player" | "battlelog" | "battlelog-modes" | "cards" | "events"): T {
  return JSON.parse(readFileSync(join(import.meta.dir, "fixtures", `${name}.json`), "utf8")) as T;
}

export const FIXTURE_TAG = "#9QJUGC2R";

/** Skips argon2 for speed; the hash is not a valid password hash. */
export function makeUser(username = "alice"): User {
  return insertUser(username, "not-a-real-hash");
}

export function seedCards(): void {
  const res = loadFixture<CardsResponse>("cards");
  upsertCards(res.items, "card");
  upsertCards(res.supportItems ?? [], "support");
}

/** Serves fixtures. Set `fail` to make a method throw, and inspect `calls` for request counts. */
export class FakeCrClient implements CrApi {
  calls = { getPlayer: 0, getPlayerBattleLog: 0, getCards: 0, getEvents: 0 };
  fail: Partial<Record<keyof FakeCrClient["calls"], CrApiError>> = {};
  player = loadFixture<Player>("player");
  battleLog = loadFixture<BattleLogEntry[]>("battlelog");
  cards = loadFixture<CardsResponse>("cards");
  events = loadFixture<GameEvent[]>("events");

  private guard(name: keyof FakeCrClient["calls"]) {
    this.calls[name]++;
    const err = this.fail[name];
    if (err) throw err;
  }
  async getPlayer(tag: string): Promise<Player> {
    this.guard("getPlayer");
    return { ...this.player, tag };
  }
  async getPlayerBattleLog(): Promise<BattleLogEntry[]> {
    this.guard("getPlayerBattleLog");
    return this.battleLog;
  }
  async getCards(): Promise<CardsResponse> {
    this.guard("getCards");
    return this.cards;
  }
  async getEvents(): Promise<GameEvent[]> {
    this.guard("getEvents");
    return this.events;
  }
}
