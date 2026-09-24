import { getDb } from "../db";
import { nowIso } from "../util";
import { randomToken, sha256Hex } from "./crypto";

/** Distinct from API_KEY_PREFIX so an admin token is never mistaken for a user key, or vice versa. */
export const ADMIN_PREFIX = "cra_";

export interface AdminTokenRecord {
  id: number;
  name: string;
  /** First 8 chars of the raw token, e.g. "cra_AbCd", for display only. */
  tokenPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface AdminTokenRow {
  id: number;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const COLUMNS = "id, name, token_prefix, last_used_at, created_at, revoked_at";

const toRecord = (r: AdminTokenRow): AdminTokenRecord => ({
  id: r.id,
  name: r.name,
  tokenPrefix: r.token_prefix,
  lastUsedAt: r.last_used_at,
  createdAt: r.created_at,
  revokedAt: r.revoked_at,
});

/** `raw` must be shown once and never again; only its hash is stored. */
export function createAdminToken(name: string): { raw: string; record: AdminTokenRecord } {
  const raw = ADMIN_PREFIX + randomToken(32);
  const row = getDb()
    .query<AdminTokenRow, [string, string, string, string]>(
      `INSERT INTO admin_tokens (name, token_hash, token_prefix, created_at) VALUES (?, ?, ?, ?)
       RETURNING ${COLUMNS}`,
    )
    .get(name.trim(), sha256Hex(raw), raw.slice(0, 8), nowIso())!;
  return { raw, record: toRecord(row) };
}

/** Stamps last_used_at on success. Revoked or unknown tokens return null. */
export function verifyAdminToken(raw: string, now: Date = new Date()): AdminTokenRecord | null {
  if (!raw.startsWith(ADMIN_PREFIX)) return null;
  const row = getDb()
    .query<AdminTokenRow, [string, string]>(
      `UPDATE admin_tokens SET last_used_at = ? WHERE token_hash = ? AND revoked_at IS NULL
       RETURNING ${COLUMNS}`,
    )
    .get(nowIso(now), sha256Hex(raw));
  return row ? toRecord(row) : null;
}

export function listAdminTokens({ includeRevoked = false } = {}): AdminTokenRecord[] {
  const where = includeRevoked ? "" : "WHERE revoked_at IS NULL";
  return getDb()
    .query<AdminTokenRow, []>(`SELECT ${COLUMNS} FROM admin_tokens ${where} ORDER BY id DESC`)
    .all()
    .map(toRecord);
}

/** False if the token doesn't exist or is already revoked. */
export function revokeAdminToken(id: number): boolean {
  return (
    getDb()
      .query("UPDATE admin_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(nowIso(), id).changes > 0
  );
}
