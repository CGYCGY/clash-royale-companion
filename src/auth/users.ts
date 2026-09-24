import { getDb } from "../db";
import { AppError } from "../errors";
import type { User } from "../types";
import { nowIso } from "../util";
import { assertPasswordPolicy } from "./passwordPolicy";
import { hashPassword, verifyPassword } from "./passwords";

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

export const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

const toUser = (r: UserRow): User => ({ id: r.id, username: r.username, createdAt: r.created_at });

/** Lowercases and trims; throws AppError("validation_error") if the result breaks the username rules. */
export function normalizeUsername(input: string): string {
  const username = input.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new AppError(
      "validation_error",
      "Username must be 3–32 characters of lowercase letters, digits, or underscore",
    );
  }
  return username;
}

/** Inserts a user whose password is already hashed. Throws AppError("conflict") if the name is taken. */
export function insertUser(username: string, passwordHash: string): User {
  const db = getDb();
  if (db.query("SELECT 1 FROM users WHERE username = ?").get(username)) {
    throw new AppError("conflict", "Username is already taken", 409);
  }
  const row = db
    .query<UserRow, [string, string, string]>(
      "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?) RETURNING *",
    )
    .get(username, passwordHash, nowIso())!;
  return toUser(row);
}

export async function createUser(usernameInput: string, password: string): Promise<User> {
  const username = normalizeUsername(usernameInput);
  assertPasswordPolicy(password, username);
  return insertUser(username, await hashPassword(password));
}

export function getUserByUsername(username: string): User | null {
  const row = getDb()
    .query<UserRow, [string]>("SELECT * FROM users WHERE username = ?")
    .get(username.trim());
  return row ? toUser(row) : null;
}

export function getUserById(id: number): User | null {
  const row = getDb().query<UserRow, [number]>("SELECT * FROM users WHERE id = ?").get(id);
  return row ? toUser(row) : null;
}

export function listUsers(): User[] {
  return getDb().query<UserRow, []>("SELECT * FROM users ORDER BY id").all().map(toUser);
}

let dummyHash: Promise<string> | null = null;

export async function verifyCredentials(username: string, password: string): Promise<User | null> {
  const row = getDb()
    .query<UserRow, [string]>("SELECT * FROM users WHERE username = ?")
    .get(username.trim());
  if (!row) {
    // Burn a comparable amount of time so response latency doesn't reveal which usernames exist.
    dummyHash ??= hashPassword("timing-equalizer-password");
    await verifyPassword(password, await dummyHash);
    return null;
  }
  return (await verifyPassword(password, row.password_hash)) ? toUser(row) : null;
}

export async function setPassword(userId: number, password: string): Promise<void> {
  const user = getUserById(userId);
  if (!user) throw new AppError("not_found", "User not found", 404);
  assertPasswordPolicy(password, user.username);
  const hash = await hashPassword(password);
  getDb().query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
}
