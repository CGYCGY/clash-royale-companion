import { getDb } from "../db";
import type { User } from "../types";
import { nowIso } from "../util";
import { randomToken, sha256Hex } from "./crypto";

export const API_KEY_PREFIX = "crk_";

export interface ApiKeyRecord {
  id: number;
  userId: number;
  name: string;
  /** First 8 chars of the raw key, e.g. "crk_AbCd", for display only. */
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface ApiKeyRow {
  id: number;
  user_id: number;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const COLUMNS = "id, user_id, name, key_prefix, last_used_at, created_at, revoked_at";

const toRecord = (r: ApiKeyRow): ApiKeyRecord => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  keyPrefix: r.key_prefix,
  lastUsedAt: r.last_used_at,
  createdAt: r.created_at,
  revokedAt: r.revoked_at,
});

/** `raw` must be shown to the user once and never again; only its hash is stored. */
export function createApiKey(userId: number, name: string): { raw: string; record: ApiKeyRecord } {
  const raw = API_KEY_PREFIX + randomToken(32);
  const row = getDb()
    .query<ApiKeyRow, [number, string, string, string, string]>(
      `INSERT INTO api_keys (user_id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)
       RETURNING ${COLUMNS}`,
    )
    .get(userId, name.trim(), sha256Hex(raw), raw.slice(0, 8), nowIso())!;
  return { raw, record: toRecord(row) };
}

/** Resolves a raw key to its owner and stamps last_used_at. Revoked or unknown keys return null. */
export function getUserByApiKey(raw: string, now: Date = new Date()): User | null {
  if (!raw.startsWith(API_KEY_PREFIX)) return null;
  const db = getDb();
  const row = db
    .query<{ key_id: number; id: number; username: string; created_at: string }, [string]>(
      `SELECT k.id AS key_id, u.id, u.username, u.created_at FROM api_keys k JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
    )
    .get(sha256Hex(raw));
  if (!row) return null;
  db.query("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(now), row.key_id);
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

export function listApiKeys(userId: number, { includeRevoked = false } = {}): ApiKeyRecord[] {
  const where = includeRevoked ? "user_id = ?" : "user_id = ? AND revoked_at IS NULL";
  return getDb()
    .query<ApiKeyRow, [number]>(`SELECT ${COLUMNS} FROM api_keys WHERE ${where} ORDER BY id DESC`)
    .all(userId)
    .map(toRecord);
}

/** Scoped to the owner; returns false if the key doesn't exist, isn't theirs, or is already revoked. */
export function revokeApiKey(userId: number, keyId: number): boolean {
  return (
    getDb()
      .query("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .run(nowIso(), keyId, userId).changes > 0
  );
}
