import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { isBearer } from "../auth/middleware";
import { config } from "../config";
import type { AppEnv } from "../types";

/**
 * Blocks cross-site form posts that would ride the session cookie. Skipped for `Authorization: Bearer`:
 * browsers never attach a Bearer header cross-site without CORS (unlike cached Basic credentials), and
 * API clients often POST without a body or Origin, which hono's csrf() would reject. `authenticate`
 * ignores the cookie on Bearer requests, so the skip can't carry a session.
 * APP_URL's origin is also accepted because behind a TLS-terminating proxy (Coolify/Traefik)
 * the request URL is http:// while the browser's Origin is https://.
 */
const appOrigin = config.APP_URL ? new URL(config.APP_URL).origin : null;

const inner = csrf({
  origin: (origin, c) => origin === new URL(c.req.url).origin || origin === appOrigin,
});

export const csrfProtection = createMiddleware<AppEnv>(async (c, next) => {
  if (isBearer(c)) return next();
  return inner(c, next);
});
