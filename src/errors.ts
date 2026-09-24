import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "bad_request"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "invalid_tag"
  | "invalid_deck"
  | "invalid_invite"
  | "upstream_error"
  | "internal_error";

/**
 * Throw from repos, services, or handlers; the app's onError turns it into
 * `{ error: { code, message, details? } }` with `status` for /api/*, or an HTML error page otherwise.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: ContentfulStatusCode = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError("not_found", `${what} not found`, 404);

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export function errorBody(code: string, message: string, details?: Record<string, unknown>): ErrorBody {
  return { error: details ? { code, message, details } : { code, message } };
}
