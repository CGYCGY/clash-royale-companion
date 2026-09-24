import type { GameEvent } from "../cr/types";
import { getDb } from "../db";
import { nowIso } from "../util";

/** Upserts only; see migration 0005 for why ended events are kept. Returns rows written. */
export function upsertEvents(events: GameEvent[]): number {
  const db = getDb();
  const stmt = db.query(
    `INSERT INTO events (event_tag, title, description, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(event_tag) DO UPDATE SET title = excluded.title, description = excluded.description,
       updated_at = excluded.updated_at`,
  );
  const now = nowIso();
  let n = 0;
  db.transaction(() => {
    for (const e of events) {
      if (!e?.eventTag || !e.title) continue;
      stmt.run(e.eventTag, e.title, e.description ?? null, now);
      n++;
    }
  })();
  return n;
}

export function countEvents(): number {
  return getDb().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get()!.n;
}

/** eventTag → title. Load once per request, not per battle. */
export function eventTitles(): Map<string, string> {
  return new Map(
    getDb()
      .query<{ event_tag: string; title: string }, []>("SELECT event_tag, title FROM events")
      .all()
      .map((r) => [r.event_tag, r.title]),
  );
}
