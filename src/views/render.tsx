import type { Context } from "hono";
import type { Child } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type PlayerContext, playerContext } from "../http/currentPlayer";
import { syncCooldownRemaining } from "../sync/manualSync";
import type { AppEnv } from "../types";
import { Layout, NAV_HREF, type NavKey } from "./Layout";

/**
 * The page to return to after a header player switch. A failed or non-GET render (a POST re-showing a
 * form with errors) has no URL worth reloading, so it falls back to its section's page.
 */
function returnPath(c: Context<AppEnv>, active: NavKey | undefined, status: number): string {
  if (c.req.method === "GET" && status < 400) {
    const url = new URL(c.req.url);
    return url.pathname + url.search;
  }
  return active ? NAV_HREF[active] : "/";
}

// Error pages render through here too; one whose cause is the database must still render.
function headerPlayers(c: Context<AppEnv>) {
  try {
    return playerContext(c);
  } catch {
    return null;
  }
}

function syncWaitFor(player: NonNullable<PlayerContext["current"]>): number {
  try {
    return syncCooldownRemaining(player);
  } catch {
    return 0;
  }
}

/** Renders `content` inside Layout with the current user, flash, and header player switcher. */
export function renderPage(
  c: Context<AppEnv>,
  opts: { title: string; active?: NavKey; status?: ContentfulStatusCode },
  content: Child,
) {
  const user = c.var.user ?? null;
  const status = opts.status ?? 200;
  const players = user ? headerPlayers(c) : null;
  return c.html(
    <Layout
      title={opts.title}
      user={user}
      flash={c.var.flash ?? null}
      active={opts.active}
      players={players}
      syncWait={players?.current ? syncWaitFor(players.current) : 0}
      next={returnPath(c, opts.active, status)}
    >
      {content}
    </Layout>,
    status,
  );
}
