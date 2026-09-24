import { getDb } from "../db";
import { AppError, notFound } from "../errors";
import { nowIso } from "../util";
import { listCards } from "./cards";

export type DeckSource = "manual" | "ai";

export interface DeckRecord {
  id: number;
  userId: number;
  name: string;
  /** Exactly 8 canonical card names from the catalog. */
  cards: string[];
  /** Markdown. */
  notes: string;
  source: DeckSource;
  createdAt: string;
  updatedAt: string;
}

interface DeckRow {
  id: number;
  user_id: number;
  name: string;
  cards: string;
  notes: string;
  source: DeckSource;
  created_at: string;
  updated_at: string;
}

const toRecord = (r: DeckRow): DeckRecord => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  cards: JSON.parse(r.cards) as string[],
  notes: r.notes,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const DECK_SIZE = 8;

/**
 * Resolves names case-insensitively against the catalog (tower troops excluded) and returns the
 * canonical spellings. Throws AppError("invalid_deck") with details { unknown, duplicates, count }.
 */
export function validateDeckCards(names: string[]): string[] {
  const byLower = new Map(listCards({ kind: "card" }).map((c) => [c.name.toLowerCase(), c.name]));
  const unknown: string[] = [];
  const canonical: string[] = [];
  for (const raw of names) {
    const found = byLower.get(raw.trim().toLowerCase());
    if (found) canonical.push(found);
    else unknown.push(raw);
  }
  const duplicates = canonical.filter((n, i) => canonical.indexOf(n) !== i);
  const problems: string[] = [];
  if (names.length !== DECK_SIZE) problems.push(`a deck needs exactly ${DECK_SIZE} cards, got ${names.length}`);
  if (unknown.length) problems.push(`unknown cards: ${unknown.join(", ")}`);
  if (duplicates.length) problems.push(`duplicate cards: ${[...new Set(duplicates)].join(", ")}`);
  if (problems.length) {
    throw new AppError("invalid_deck", `Invalid deck: ${problems.join("; ")}`, 400, {
      unknown,
      duplicates: [...new Set(duplicates)],
      count: names.length,
    });
  }
  return canonical;
}

export interface DeckInput {
  name: string;
  cards: string[];
  notes?: string;
  source?: DeckSource;
}

export function createDeck(userId: number, input: DeckInput): DeckRecord {
  const cards = validateDeckCards(input.cards);
  const now = nowIso();
  const row = getDb()
    .query<DeckRow, [number, string, string, string, DeckSource, string, string]>(
      `INSERT INTO decks (user_id, name, cards, notes, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(userId, input.name.trim(), JSON.stringify(cards), input.notes ?? "", input.source ?? "manual", now, now)!;
  return toRecord(row);
}

export function listDecks(userId: number): DeckRecord[] {
  return getDb()
    .query<DeckRow, [number]>("SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC, id DESC")
    .all(userId)
    .map(toRecord);
}

export function getDeck(userId: number, id: number): DeckRecord | null {
  const row = getDb().query<DeckRow, [number, number]>("SELECT * FROM decks WHERE id = ? AND user_id = ?").get(id, userId);
  return row ? toRecord(row) : null;
}

/** Partial update; throws 404 if the deck isn't the user's, invalid_deck if `cards` is bad. */
export function updateDeck(userId: number, id: number, patch: Partial<DeckInput>): DeckRecord {
  const existing = getDeck(userId, id);
  if (!existing) throw notFound("Deck");
  const cards = patch.cards ? validateDeckCards(patch.cards) : existing.cards;
  const row = getDb()
    .query<DeckRow, [string, string, string, DeckSource, string, number, number]>(
      `UPDATE decks SET name = ?, cards = ?, notes = ?, source = ?, updated_at = ?
       WHERE id = ? AND user_id = ? RETURNING *`,
    )
    .get(
      patch.name?.trim() ?? existing.name,
      JSON.stringify(cards),
      patch.notes ?? existing.notes,
      patch.source ?? existing.source,
      nowIso(),
      id,
      userId,
    )!;
  return toRecord(row);
}

export function deleteDeck(userId: number, id: number): boolean {
  return getDb().query("DELETE FROM decks WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}
