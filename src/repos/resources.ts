import { getDb } from "../db";
import { nowIso } from "../util";

export interface PlayerResources {
  gold: number | null;
  gems: number | null;
  updatedAt: string;
}

export function getResources(tag: string): PlayerResources | null {
  const row = getDb()
    .query<{ gold: number | null; gems: number | null; updated_at: string }, [string]>(
      "SELECT gold, gems, updated_at FROM player_resources WHERE player_tag = ?",
    )
    .get(tag);
  return row ? { gold: row.gold, gems: row.gems, updatedAt: row.updated_at } : null;
}

export function setResources(tag: string, { gold, gems }: { gold: number | null; gems: number | null }): PlayerResources {
  const updatedAt = nowIso();
  getDb()
    .query(
      `INSERT INTO player_resources (player_tag, gold, gems, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(player_tag) DO UPDATE SET gold = excluded.gold, gems = excluded.gems, updated_at = excluded.updated_at`,
    )
    .run(tag, gold, gems, updatedAt);
  return { gold, gems, updatedAt };
}
