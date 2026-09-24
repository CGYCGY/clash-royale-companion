import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isSecureCookie } from "../config";
import { normalizeTag, tagSlug } from "../cr/tag";
import { notFound } from "../errors";
import { listPlayersForUser, type PlayerRecord } from "../repos/players";
import type { AppEnv } from "../types";

/** Holds a tag slug. Only a UI preference: every read is re-checked against the user's linked players. */
export const PLAYER_COOKIE = "cr_player";

export interface PlayerContext {
  players: PlayerRecord[];
  /** Null only when the user has no linked players. */
  current: PlayerRecord | null;
}

export function rememberPlayer(c: Context, tag: string): void {
  setCookie(c, PLAYER_COOKIE, tagSlug(tag), {
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureCookie(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

function resolve(c: Context<AppEnv>, requested: string | null): PlayerContext {
  const cached = c.get("playerContext");
  if (cached && requested === null) return cached;
  const user = c.var.user;
  const players = user ? listPlayersForUser(user.id) : [];
  let current: PlayerRecord | null;
  if (requested !== null) {
    current = players.find((p) => p.tag === requested) ?? null;
    // 404 rather than falling back, so a link to someone else's tag can't be mistaken for it.
    if (!current) throw notFound("Player");
    if (getCookie(c, PLAYER_COOKIE) !== tagSlug(current.tag)) rememberPlayer(c, current.tag);
  } else {
    const raw = getCookie(c, PLAYER_COOKIE);
    const remembered = raw ? players.find((p) => tagSlug(p.tag) === raw) : undefined;
    current = remembered ?? players[0] ?? null;
    if (raw && !remembered) {
      if (current) rememberPlayer(c, current.tag);
      else deleteCookie(c, PLAYER_COOKIE, { path: "/", secure: isSecureCookie() });
    }
  }
  const ctx = { players, current };
  c.set("playerContext", ctx);
  return ctx;
}

/** The header's view: remembered player if still linked, else the first. Never throws, so error pages can use it. */
export const playerContext = (c: Context<AppEnv>): PlayerContext => resolve(c, null);

/**
 * For player pages. `?tag=` (old links and bookmarks) selects and remembers a player and must name one
 * of the user's own (404 otherwise); without it this is playerContext.
 */
export function resolvePlayer(c: Context<AppEnv>): PlayerContext {
  const raw = c.req.query("tag");
  return resolve(c, raw ? normalizeTag(raw) : null);
}

const BATTLE_DETAIL_RE = /^\/battles\/[^/]+\/\d+\/?$/;

/**
 * Where to land after switching player from `next` (already safeNext-ed): the same page minus anything
 * tied to the old player. `tag` would re-select it, `page` may be past the new player's last page, and a
 * battle detail belongs to one player.
 */
export function afterSwitchPath(next: string): string {
  const url = new URL(next, "http://x");
  if (BATTLE_DETAIL_RE.test(url.pathname)) return "/battles";
  url.searchParams.delete("tag");
  url.searchParams.delete("page");
  url.searchParams.delete("partial");
  const qs = url.searchParams.toString();
  return url.pathname + (qs ? `?${qs}` : "");
}
