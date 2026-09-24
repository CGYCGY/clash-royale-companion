import type { CatalogCard, Rarity } from "../cr/types";
import { getDb } from "../db";
import { nowIso } from "../util";

export type CardKind = "card" | "support";

export interface CardRecord {
  id: number;
  name: string;
  /** "support" = tower troops from the API's supportItems. */
  kind: CardKind;
  rarity: Rarity;
  elixirCost: number | null;
  maxLevel: number;
  maxEvolutionLevel: number | null;
  iconUrl: string | null;
  iconUrlEvo: string | null;
  updatedAt: string;
}

interface CardRow {
  id: number;
  name: string;
  kind: CardKind;
  rarity: Rarity;
  elixir_cost: number | null;
  max_level: number;
  max_evolution_level: number | null;
  icon_url: string | null;
  icon_url_evo: string | null;
  updated_at: string;
}

const COLUMNS =
  "id, name, kind, rarity, elixir_cost, max_level, max_evolution_level, icon_url, icon_url_evo, updated_at";

const toRecord = (r: CardRow): CardRecord => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  rarity: r.rarity,
  elixirCost: r.elixir_cost,
  maxLevel: r.max_level,
  maxEvolutionLevel: r.max_evolution_level,
  iconUrl: r.icon_url,
  iconUrlEvo: r.icon_url_evo,
  updatedAt: r.updated_at,
});

export function upsertCards(items: CatalogCard[], kind: CardKind = "card"): number {
  const db = getDb();
  const stmt = db.query(
    `INSERT INTO cards (id, name, kind, rarity, elixir_cost, max_level, max_evolution_level, icon_url, icon_url_evo, data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, rarity = excluded.rarity,
       elixir_cost = excluded.elixir_cost, max_level = excluded.max_level,
       max_evolution_level = excluded.max_evolution_level, icon_url = excluded.icon_url,
       icon_url_evo = excluded.icon_url_evo, data = excluded.data, updated_at = excluded.updated_at`,
  );
  const now = nowIso();
  db.transaction(() => {
    for (const c of items) {
      stmt.run(
        c.id,
        c.name,
        kind,
        c.rarity,
        c.elixirCost ?? null,
        c.maxLevel,
        c.maxEvolutionLevel ?? null,
        c.iconUrls.medium ?? null,
        c.iconUrls.evolutionMedium ?? null,
        JSON.stringify(c),
        now,
      );
    }
  })();
  return items.length;
}

export function listCards({ kind }: { kind?: CardKind } = {}): CardRecord[] {
  const db = getDb();
  const rows = kind
    ? db.query<CardRow, [string]>(`SELECT ${COLUMNS} FROM cards WHERE kind = ? ORDER BY name`).all(kind)
    : db.query<CardRow, []>(`SELECT ${COLUMNS} FROM cards ORDER BY name`).all();
  return rows.map(toRecord);
}

export function countCards(): number {
  return getDb().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM cards").get()!.n;
}

/** Case-insensitive exact name match. */
export function getCardByName(name: string): CardRecord | null {
  const row = getDb()
    .query<CardRow, [string]>(`SELECT ${COLUMNS} FROM cards WHERE name = ? COLLATE NOCASE LIMIT 1`)
    .get(name.trim());
  return row ? toRecord(row) : null;
}

export function getCardById(id: number): CardRecord | null {
  const row = getDb().query<CardRow, [number]>(`SELECT ${COLUMNS} FROM cards WHERE id = ?`).get(id);
  return row ? toRecord(row) : null;
}

/** All cards keyed by exact name. Load once per request/sync, not per card. */
export function cardsMap(): Map<string, CardRecord> {
  return new Map(listCards().map((c) => [c.name, c]));
}

export function cardsById(): Map<number, CardRecord> {
  return new Map(listCards().map((c) => [c.id, c]));
}
