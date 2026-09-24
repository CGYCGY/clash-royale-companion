import { AppError } from "../errors";
import { COMMON_PASSWORDS } from "./commonPasswords";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const PASSWORD_MIN_CLASSES = 3;
/** A password fails when its most frequent character (case-insensitive) is more than this share of it. */
export const PASSWORD_MAX_SAME_SHARE = 0.5;
const USERNAME_CHECK_MIN = 3;

// Patterns are strings because they are also shipped to public/app.js for the live checklist.
// Anything matching none of them (space, punctuation, non-ASCII) counts as a symbol.
const CHAR_CLASSES = [
  { id: "lower", pattern: "[a-z]" },
  { id: "upper", pattern: "[A-Z]" },
  { id: "digit", pattern: "[0-9]" },
] as const;

export type PasswordRuleId = "length" | "classes" | "username" | "repeated" | "common";

export interface PasswordProblem {
  rule: PasswordRuleId;
  message: string;
}

const commonSet = new Set(COMMON_PASSWORDS.map((p) => p.toLowerCase()));

function classCount(chars: string[]): number {
  const res = CHAR_CLASSES.map((c) => new RegExp(c.pattern));
  const seen = new Set<number>();
  for (const ch of chars) {
    const i = res.findIndex((re) => re.test(ch));
    seen.add(i); // -1 is the symbol class
  }
  return seen.size;
}

function mostlyOneChar(chars: string[]): boolean {
  if (!chars.length) return false;
  const counts = new Map<string, number>();
  for (const ch of chars) {
    const k = ch.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Math.max(...counts.values()) > chars.length * PASSWORD_MAX_SAME_SHARE;
}

/** Every rule the password breaks, in display order; empty when it's acceptable. Login must not call this. */
export function validatePassword(password: string, username?: string): PasswordProblem[] {
  // Spread splits by code point, so an emoji counts as one character rather than two UTF-16 units.
  const chars = [...password];
  const problems: PasswordProblem[] = [];
  if (chars.length < PASSWORD_MIN) {
    problems.push({ rule: "length", message: `Password must be at least ${PASSWORD_MIN} characters.` });
  } else if (chars.length > PASSWORD_MAX) {
    problems.push({ rule: "length", message: `Password must be at most ${PASSWORD_MAX} characters.` });
  }
  if (classCount(chars) < PASSWORD_MIN_CLASSES) {
    problems.push({
      rule: "classes",
      message: `Password must mix at least ${PASSWORD_MIN_CLASSES} of: lowercase letters, uppercase letters, digits, symbols.`,
    });
  }
  const name = username?.trim().toLowerCase() ?? "";
  if (name.length >= USERNAME_CHECK_MIN && password.toLowerCase().includes(name)) {
    problems.push({ rule: "username", message: "Password must not contain your username." });
  }
  if (mostlyOneChar(chars)) {
    problems.push({ rule: "repeated", message: "Password must not be made mostly of one repeated character." });
  }
  if (commonSet.has(password.toLowerCase())) {
    problems.push({ rule: "common", message: "That password is too common. Pick something less guessable." });
  }
  return problems;
}

export class PasswordPolicyError extends AppError {
  constructor(readonly problems: PasswordProblem[]) {
    super("validation_error", problems.map((p) => p.message).join(" "), 400, {
      problems: problems.map((p) => ({ rule: p.rule, message: p.message })),
    });
  }
}

/** Throws PasswordPolicyError (a validation_error AppError) listing every broken rule. */
export function assertPasswordPolicy(password: string, username?: string): void {
  const problems = validatePassword(password, username);
  if (problems.length) throw new PasswordPolicyError(problems);
}

/**
 * What public/app.js needs to run the live checklist. The common-password rule stays server-only so
 * the list isn't shipped to every visitor.
 */
export function passwordPolicyClientConfig() {
  return {
    min: PASSWORD_MIN,
    max: PASSWORD_MAX,
    minClasses: PASSWORD_MIN_CLASSES,
    maxSameShare: PASSWORD_MAX_SAME_SHARE,
    usernameMin: USERNAME_CHECK_MIN,
    classPatterns: CHAR_CLASSES.map((c) => c.pattern),
    rules: [
      { id: "length", label: `${PASSWORD_MIN}–${PASSWORD_MAX} characters` },
      { id: "classes", label: `At least ${PASSWORD_MIN_CLASSES} of: lowercase, uppercase, digit, symbol` },
      { id: "username", label: "Doesn't contain your username" },
      { id: "repeated", label: "Not mostly one repeated character" },
    ] satisfies { id: PasswordRuleId; label: string }[],
  };
}
