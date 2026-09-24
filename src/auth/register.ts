import { getDb } from "../db";
import { AppError } from "../errors";
import type { User } from "../types";
import { consumeInvite } from "./invites";
import { hashPassword } from "./passwords";
import { insertUser, normalizeUsername, validatePassword } from "./users";

/**
 * Invite-gated signup. The invite use and the user insert share one transaction, so a taken
 * username rolls back the consumed invite use.
 * Throws AppError: validation_error | invalid_invite | conflict.
 */
export async function registerWithInvite(input: {
  username: string;
  password: string;
  inviteCode: string;
}): Promise<User> {
  const username = normalizeUsername(input.username);
  validatePassword(input.password);
  const hash = await hashPassword(input.password);
  const db = getDb();
  return db.transaction(() => {
    if (!consumeInvite(input.inviteCode)) {
      throw new AppError("invalid_invite", "Invite code is invalid, expired, or already used", 400);
    }
    return insertUser(username, hash);
  })();
}
