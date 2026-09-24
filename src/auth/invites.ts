import { getDb } from "../db";
import { nowIso } from "../util";
import { randomString } from "./crypto";

// No 0/O or 1/I since codes get read aloud and retyped. 32 symbols divides 256, so no modulo bias.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 12;

export interface InviteRecord {
  id: number;
  code: string;
  maxUses: number;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface InviteRow {
  id: number;
  code: string;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const toRecord = (r: InviteRow): InviteRecord => ({
  id: r.id,
  code: r.code,
  maxUses: r.max_uses,
  uses: r.uses,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
  revokedAt: r.revoked_at,
});

export const normalizeInviteCode = (code: string): string => code.trim().toUpperCase();

export function createInvite(
  { maxUses = 1, expiresInDays }: { maxUses?: number; expiresInDays?: number } = {},
  now: Date = new Date(),
): InviteRecord {
  const expiresAt =
    expiresInDays === undefined ? null : new Date(now.getTime() + expiresInDays * 86_400_000).toISOString();
  const row = getDb()
    .query<InviteRow, [string, number, string | null, string]>(
      "INSERT INTO invites (code, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?) RETURNING *",
    )
    .get(randomString(INVITE_CODE_LENGTH, CODE_ALPHABET), maxUses, expiresAt, nowIso(now))!;
  return toRecord(row);
}

/**
 * Atomically claims one use. A single conditional UPDATE, so concurrent registrations can't
 * both take the last use. Returns false for unknown, revoked, expired, or exhausted codes.
 * Call inside the same transaction as the user insert so a failed signup doesn't burn a use.
 */
export function consumeInvite(code: string, now: Date = new Date()): boolean {
  const result = getDb()
    .query(
      `UPDATE invites SET uses = uses + 1
       WHERE code = ? AND revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .run(normalizeInviteCode(code), nowIso(now));
  return result.changes > 0;
}

export function getInviteByCode(code: string): InviteRecord | null {
  const row = getDb()
    .query<InviteRow, [string]>("SELECT * FROM invites WHERE code = ?")
    .get(normalizeInviteCode(code));
  return row ? toRecord(row) : null;
}

export function isInviteUsable(invite: InviteRecord, now: Date = new Date()): boolean {
  return (
    invite.revokedAt === null &&
    invite.uses < invite.maxUses &&
    (invite.expiresAt === null || invite.expiresAt > nowIso(now))
  );
}

export function listInvites(): InviteRecord[] {
  return getDb().query<InviteRow, []>("SELECT * FROM invites ORDER BY id DESC").all().map(toRecord);
}

export function revokeInvite(id: number): boolean {
  return (
    getDb().query("UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(nowIso(), id)
      .changes > 0
  );
}
