import { z } from "zod";
import { PasswordPolicyError } from "../../auth/passwordPolicy";
import { AppError, type ErrorCode } from "../../errors";

/** Form text field: missing becomes "", repeated keys fail validation. */
export const text = z.string().default("");

/**
 * Message for an AppError a form should re-render with: validation_error always, plus the codes in
 * `handled` (a string rewords it, `true` keeps the error's own message). Rethrows anything else.
 */
export function formError(err: unknown, handled: Partial<Record<ErrorCode, string | true>> = {}): string {
  if (!(err instanceof AppError)) throw err;
  const h = handled[err.code];
  if (typeof h === "string") return h;
  if (h === true || err.code === "validation_error") return err.message;
  throw err;
}

/** Like formError, but a password policy failure yields one message per broken rule. */
export function formErrors(err: unknown, handled: Partial<Record<ErrorCode, string | true>> = {}): string[] {
  if (err instanceof PasswordPolicyError) return err.problems.map((p) => p.message);
  return [formError(err, handled)];
}

/**
 * Only same-origin relative paths. Browsers strip tabs/newlines and treat "\\" as "/", so
 * "/\t/evil.com" or "/\\evil.com" would become protocol-relative; reject any whitespace or control
 * char and let URL parsing settle the rest.
 */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || /[\s\x00-\x1f\x7f\\]/.test(next)) return "/";
  let url: URL;
  try {
    url = new URL(next, "http://x");
  } catch {
    return "/";
  }
  if (url.origin !== "http://x") return "/";
  return url.pathname + url.search + url.hash;
}

export const idParam = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError("not_found", "Not found", 404);
  return id;
};
