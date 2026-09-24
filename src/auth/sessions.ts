import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isSecureCookie } from "../config";
import { getDb } from "../db";
import type { User } from "../types";
import { nowIso } from "../util";
import { randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "cr_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Creates a session and returns the raw token (only its hash is stored). */
export function createSession(userId: number, now: Date = new Date()): string {
  const token = randomToken(32);
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  getDb()
    .query(
      "INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(userId, sha256Hex(token), expires.toISOString(), nowIso(now));
  return token;
}

export function getUserBySessionToken(token: string, now: Date = new Date()): User | null {
  const row = getDb()
    .query<{ id: number; username: string; created_at: string }, [string, string]>(
      `SELECT u.id, u.username, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256Hex(token), nowIso(now));
  return row ? { id: row.id, username: row.username, createdAt: row.created_at } : null;
}

export function deleteSession(token: string): void {
  getDb().query("DELETE FROM sessions WHERE token_hash = ?").run(sha256Hex(token));
}

export function deleteSessionsForUser(userId: number): void {
  getDb().query("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function purgeExpiredSessions(now: Date = new Date()): number {
  return getDb().query("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso(now)).changes;
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureCookie(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecureCookie() });
}

export const getSessionToken = (c: Context): string | undefined => getCookie(c, SESSION_COOKIE);

/** Logs the user in on this response: new session row + cookie. */
export function startSession(c: Context, userId: number): void {
  setSessionCookie(c, createSession(userId));
}

export function endSession(c: Context): void {
  const token = getSessionToken(c);
  if (token) deleteSession(token);
  clearSessionCookie(c);
}
