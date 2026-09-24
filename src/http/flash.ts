import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { isSecureCookie } from "../config";
import type { AppEnv, Flash } from "../types";

const FLASH_COOKIE = "cr_flash";

/** Queue a one-shot message shown on the next rendered page (use before a redirect). */
export function setFlash(c: Context, type: Flash["type"], message: string, target?: string): void {
  const value = Buffer.from(JSON.stringify({ type, message, target })).toString("base64url");
  setCookie(c, FLASH_COOKIE, value, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureCookie(),
    path: "/",
    maxAge: 60,
  });
}

/** Global. Moves the flash cookie into `c.var.flash` and clears it. */
export const flashMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set("flash", null);
  const raw = getCookie(c, FLASH_COOKIE);
  if (raw) {
    try {
      const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Flash;
      if (typeof parsed.message === "string") c.set("flash", parsed);
    } catch {
      // Malformed cookie: drop it.
    }
    deleteCookie(c, FLASH_COOKIE, { path: "/" });
  }
  await next();
});
