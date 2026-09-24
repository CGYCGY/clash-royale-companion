import { beforeEach, describe, expect, test } from "bun:test";
import { createApiKey, getUserByApiKey, listApiKeys, revokeApiKey } from "../src/auth/apiKeys";
import { consumeInvite, createInvite, getInviteByCode, revokeInvite } from "../src/auth/invites";
import { registerWithInvite } from "../src/auth/register";
import {
  createSession,
  deleteSession,
  getUserBySessionToken,
  purgeExpiredSessions,
  SESSION_TTL_SECONDS,
} from "../src/auth/sessions";
import { createUser, getUserByUsername, verifyCredentials } from "../src/auth/users";
import { AppError } from "../src/errors";
import { makeTestDb, makeUser } from "./helpers";

beforeEach(() => {
  makeTestDb();
});

describe("invites", () => {
  test("code is 12 unambiguous chars", () => {
    const { code } = createInvite();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });

  test("single-use invite is consumed once", () => {
    const { code } = createInvite({ maxUses: 1 });
    expect(consumeInvite(code)).toBe(true);
    expect(consumeInvite(code)).toBe(false);
    expect(getInviteByCode(code)!.uses).toBe(1);
  });

  test("max uses is honored exactly, even with many back-to-back attempts", () => {
    const { code } = createInvite({ maxUses: 3 });
    const results = Array.from({ length: 10 }, () => consumeInvite(code));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(getInviteByCode(code)!.uses).toBe(3);
  });

  test("expired invites are rejected", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const { code } = createInvite({ maxUses: 5, expiresInDays: 7 }, created);
    expect(consumeInvite(code, new Date("2026-01-07T23:59:59Z"))).toBe(true);
    expect(consumeInvite(code, new Date("2026-01-08T00:00:01Z"))).toBe(false);
  });

  test("revoked invites are rejected; codes are case-insensitive", () => {
    const a = createInvite({ maxUses: 5 });
    expect(consumeInvite(a.code.toLowerCase())).toBe(true);
    revokeInvite(a.id);
    expect(consumeInvite(a.code)).toBe(false);
    expect(consumeInvite("NOPE")).toBe(false);
  });
});

describe("registerWithInvite", () => {
  test("creates a user and consumes the invite", async () => {
    const { code } = createInvite();
    const user = await registerWithInvite({ username: "Alice_1", password: "hunter2hunter2", inviteCode: code });
    expect(user.username).toBe("alice_1");
    expect(getInviteByCode(code)!.uses).toBe(1);
    expect(await verifyCredentials("alice_1", "hunter2hunter2")).toMatchObject({ id: user.id });
    expect(await verifyCredentials("alice_1", "wrong-password")).toBeNull();
    expect(await verifyCredentials("nobody", "whatever1")).toBeNull();
  });

  test("taken username rolls back the invite use", async () => {
    makeUser("bob");
    const { code } = createInvite();
    const err = await registerWithInvite({ username: "BOB", password: "longenough", inviteCode: code }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("conflict");
    expect(getInviteByCode(code)!.uses).toBe(0);
  });

  test("bad invite and bad input are rejected", async () => {
    const bad = await registerWithInvite({ username: "carol", password: "longenough", inviteCode: "XXXX" }).catch((e) => e);
    expect(bad.code).toBe("invalid_invite");
    const { code } = createInvite();
    const shortName = await registerWithInvite({ username: "ab", password: "longenough", inviteCode: code }).catch((e) => e);
    expect(shortName.code).toBe("validation_error");
    const shortPw = await registerWithInvite({ username: "carol", password: "short", inviteCode: code }).catch((e) => e);
    expect(shortPw.code).toBe("validation_error");
    expect(getInviteByCode(code)!.uses).toBe(0);
  });

  test("usernames are unique case-insensitively", async () => {
    await createUser("dave", "longenough");
    expect(getUserByUsername("DAVE")?.username).toBe("dave");
  });
});

describe("sessions", () => {
  test("token resolves to its user until expiry", () => {
    const user = makeUser();
    const now = new Date("2026-03-01T00:00:00Z");
    const token = createSession(user.id, now);
    expect(getUserBySessionToken(token, now)?.id).toBe(user.id);
    const justBefore = new Date(now.getTime() + (SESSION_TTL_SECONDS - 1) * 1000);
    const after = new Date(now.getTime() + (SESSION_TTL_SECONDS + 1) * 1000);
    expect(getUserBySessionToken(token, justBefore)?.id).toBe(user.id);
    expect(getUserBySessionToken(token, after)).toBeNull();
    expect(purgeExpiredSessions(after)).toBe(1);
  });

  test("delete and unknown tokens", () => {
    const user = makeUser();
    const token = createSession(user.id);
    deleteSession(token);
    expect(getUserBySessionToken(token)).toBeNull();
    expect(getUserBySessionToken("garbage")).toBeNull();
  });
});

describe("api keys", () => {
  test("create returns raw once; lookup by raw works and stamps last_used_at", () => {
    const user = makeUser();
    const { raw, record } = createApiKey(user.id, "claude");
    expect(raw.startsWith("crk_")).toBe(true);
    expect(record.keyPrefix).toBe(raw.slice(0, 8));
    expect(record.lastUsedAt).toBeNull();
    expect(getUserByApiKey(raw)?.id).toBe(user.id);
    expect(listApiKeys(user.id)[0]!.lastUsedAt).not.toBeNull();
    expect(getUserByApiKey("crk_wrong")).toBeNull();
    expect(getUserByApiKey("not-a-key")).toBeNull();
  });

  test("revoke is owner-scoped and disables the key", () => {
    const alice = makeUser("alice");
    const mallory = makeUser("mallory");
    const { raw, record } = createApiKey(alice.id, "k");
    expect(revokeApiKey(mallory.id, record.id)).toBe(false);
    expect(revokeApiKey(alice.id, record.id)).toBe(true);
    expect(revokeApiKey(alice.id, record.id)).toBe(false);
    expect(getUserByApiKey(raw)).toBeNull();
    expect(listApiKeys(alice.id)).toHaveLength(0);
    expect(listApiKeys(alice.id, { includeRevoked: true })).toHaveLength(1);
  });
});
