import { beforeEach, describe, expect, test } from "bun:test";
import { COMMON_PASSWORDS } from "../src/auth/commonPasswords";
import {
  assertPasswordPolicy,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PasswordPolicyError,
  passwordPolicyClientConfig,
  validatePassword,
} from "../src/auth/passwordPolicy";
import { hashPassword } from "../src/auth/passwords";
import { createUser, getUserByUsername, insertUser, setPassword, verifyCredentials } from "../src/auth/users";
import { makeTestDb } from "./helpers";

const rules = (pw: string, username?: string) => validatePassword(pw, username).map((p) => p.rule);
const GOOD = "Blue-Otter-4412";

describe("validatePassword", () => {
  test("accepts a compliant password", () => {
    expect(validatePassword(GOOD)).toEqual([]);
    expect(validatePassword(GOOD, "alice")).toEqual([]);
  });

  test("length bounds are 12 and 128", () => {
    expect(rules("Abcdef-1234")).toEqual(["length"]);
    expect(rules("Abcdef-12345")).toEqual([]);
    const max = "Ab1-".repeat(PASSWORD_MAX / 4);
    expect(max).toHaveLength(PASSWORD_MAX);
    expect(rules(max)).toEqual([]);
    expect(rules(`${max}x`)).toEqual(["length"]);
    expect(validatePassword("Ab1-")[0]!.message).toContain(`at least ${PASSWORD_MIN}`);
    expect(validatePassword(`${max}x`)[0]!.message).toContain(`at most ${PASSWORD_MAX}`);
  });

  test("length counts code points, not UTF-16 units", () => {
    // 8 emoji are 16 UTF-16 units but only 8 characters.
    expect(rules("Ab1😀🎉🚀🌈🍕🐱🎈🔥")).toEqual(["length"]);
    expect("Ab1😀🎉🚀🌈🍕🐱🎈🔥".length).toBe(19);
    expect(rules("Ab1-😀🎉🚀🌈🍕🐱🎈🔥")).toEqual([]);
    const max = "😀a".repeat(PASSWORD_MAX / 2);
    expect(max.length).toBe(PASSWORD_MAX * 1.5);
    expect(rules(`${max.slice(0, -1)}B1`)).toEqual(["length"]);
    expect(rules(max.slice(0, -3) + "B1")).toEqual([]);
  });

  test("needs 3 of 4 character classes; spaces and non-ASCII count as symbols", () => {
    expect(rules("bluebirdsinging")).toEqual(["classes"]);
    expect(rules("bluebirds1nging")).toEqual(["classes"]);
    expect(rules("Bluebirds1nging")).toEqual([]);
    expect(rules("bluebirds singing1")).toEqual([]);
    expect(rules("blåbärssylt1234")).toEqual([]);
    expect(rules("BLUEBIRD-SONGS")).toEqual(["classes"]);
  });

  test("must not contain the username, case-insensitively, when it has 3+ chars", () => {
    expect(rules("Hello-Alice-2024", "alice")).toEqual(["username"]);
    expect(rules("Hello-ALICE-2024", "Alice")).toEqual(["username"]);
    expect(rules("Hello-Al-2024-xyz", "al")).toEqual([]);
    expect(rules("Hello-Alice-2024")).toEqual([]);
  });

  test("rejects common passwords case-insensitively", () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(100);
    expect(rules("Password123!")).toEqual(["common"]);
    expect(rules("PASSWORD123!")).toEqual(["common"]);
    expect(rules("qwerty123456")).toEqual(["classes", "common"]);
  });

  test("rejects a single repeated character or mostly one character", () => {
    expect(rules("aaaaaaaaaaaaaa")).toEqual(["classes", "repeated"]);
    expect(rules("aaaaaaaAAA1!")).toEqual(["repeated"]);
    expect(rules("aaaaaaB1!xyz")).toEqual([]);
  });

  test("reports every failed rule at once, in display order", () => {
    const problems = validatePassword("hi-bob", "bob");
    expect(problems.map((p) => p.rule)).toEqual(["length", "classes", "username"]);
    for (const p of problems) expect(p.message).toMatch(/^[A-Z].*\.$/);
  });

  test("assertPasswordPolicy throws a validation_error carrying every problem", () => {
    const err = (() => {
      try {
        assertPasswordPolicy("aaaa");
      } catch (e) {
        return e;
      }
    })() as PasswordPolicyError;
    expect(err).toBeInstanceOf(PasswordPolicyError);
    expect(err.code).toBe("validation_error");
    expect(err.problems.map((p) => p.rule)).toEqual(["length", "classes", "repeated"]);
    expect(err.details).toEqual({ problems: err.problems });
    expect(() => assertPasswordPolicy(GOOD)).not.toThrow();
  });

  test("client config mirrors the server rules except the common list", () => {
    const cfg = passwordPolicyClientConfig();
    expect(cfg.min).toBe(PASSWORD_MIN);
    expect(cfg.max).toBe(PASSWORD_MAX);
    expect(cfg.rules.map((r) => r.id)).toEqual(["length", "classes", "username", "repeated"]);
    expect(JSON.stringify(cfg)).not.toContain("Qwerty");
  });
});

describe("policy enforcement", () => {
  beforeEach(() => {
    makeTestDb();
  });

  test("createUser and setPassword enforce the policy, including the username rule", async () => {
    await expect(createUser("erin", "short")).rejects.toBeInstanceOf(PasswordPolicyError);
    await expect(createUser("erin", "Erin-Is-Great-1")).rejects.toThrow("must not contain your username");
    const user = await createUser("erin", GOOD);
    const err = await setPassword(user.id, "Password123!").catch((e) => e);
    expect(err).toBeInstanceOf(PasswordPolicyError);
    expect(await verifyCredentials("erin", GOOD)).not.toBeNull();
  });

  test("login does not apply the policy to existing passwords", async () => {
    insertUser("legacy", await hashPassword("oldpass"));
    expect(await verifyCredentials("legacy", "oldpass")).toMatchObject({ id: getUserByUsername("legacy")!.id });
  });
});
