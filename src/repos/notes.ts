import { getDb } from "../db";
import { nowIso } from "../util";

export interface PlayerNotes {
  content: string;
  updatedAt: string;
}

export function getNotes(tag: string): PlayerNotes | null {
  const row = getDb()
    .query<{ content: string; updated_at: string }, [string]>(
      "SELECT content, updated_at FROM player_notes WHERE player_tag = ?",
    )
    .get(tag);
  return row ? { content: row.content, updatedAt: row.updated_at } : null;
}

export function setNotes(tag: string, content: string): PlayerNotes {
  const updatedAt = nowIso();
  getDb()
    .query(
      `INSERT INTO player_notes (player_tag, content, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(player_tag) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    )
    .run(tag, content, updatedAt);
  return { content, updatedAt };
}
