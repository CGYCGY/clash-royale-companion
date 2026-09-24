import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { requireEnv } from "../config";
import { errorBody } from "../errors";
import type { AppEnv, User } from "../types";
import { API_KEY_PREFIX, getUserByApiKey } from "./apiKeys";
import { safeEqual } from "./crypto";
import { getSessionToken, getUserBySessionToken } from "./sessions";

export const isApiRequest = (c: Context): boolean =>
  c.req.path === "/api" || c.req.path.startsWith("/api/");

/** Any `Authorization: Bearer ...` header, well-formed or not. Shared with csrfProtection. */
export const isBearer = (c: Context): boolean => /^Bearer(\s|$)/i.test(c.req.header("Authorization") ?? "");

function bearerToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1] ?? null;
}

/**
 * Global. Resolves `c.var.user` / `c.var.authMethod` from `Authorization: Bearer crk_...` or the
 * session cookie; never rejects. A Bearer request never falls back to the cookie: csrfProtection
 * skips exactly those requests, so a fallback would let one ride the session past the CSRF check.
 * Other schemes (e.g. Basic from an auth proxy, which browsers attach cross-site) keep the cookie
 * and stay CSRF-checked.
 */
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", null);
  c.set("authMethod", null);
  if (isBearer(c)) {
    const bearer = bearerToken(c);
    const user = bearer?.startsWith(API_KEY_PREFIX) ? getUserByApiKey(bearer) : null;
    if (user) {
      c.set("user", user);
      c.set("authMethod", "apikey");
    }
  } else {
    const token = getSessionToken(c);
    const user = token ? getUserBySessionToken(token) : null;
    if (user) {
      c.set("user", user);
      c.set("authMethod", "session");
    }
  }
  await next();
});

function loginRedirect(c: Context) {
  const url = new URL(c.req.url);
  return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
}

/** Any authenticated user. 401 JSON under /api/*, redirect to /login for pages. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) {
    if (isApiRequest(c)) {
      return c.json(errorBody("unauthorized", "Authentication required"), 401);
    }
    return loginRedirect(c);
  }
  await next();
});

/** Browser session only (API keys are rejected). Use for API key management and account settings. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.authMethod !== "session") {
    if (isApiRequest(c)) {
      const status = c.var.user ? 403 : 401;
      return c.json(
        errorBody(
          status === 403 ? "forbidden" : "unauthorized",
          status === 403 ? "This endpoint requires a browser session, not an API key" : "Authentication required",
        ),
        status,
      );
    }
    return loginRedirect(c);
  }
  await next();
});

/** `Authorization: Bearer <ADMIN_TOKEN>`. Independent of user auth. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c);
  if (!token || !safeEqual(token, requireEnv("ADMIN_TOKEN"))) {
    return c.json(errorBody("unauthorized", "Invalid admin token"), 401);
  }
  await next();
});

/** The authenticated user in a handler behind requireUser/requireSession. Throws if absent. */
export function currentUser(c: Context<AppEnv>): User {
  const user = c.var.user;
  if (!user) throw new Error("currentUser() called on a route without requireUser");
  return user;
}
