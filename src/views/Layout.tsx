import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { tagSlug } from "../cr/tag";
import { assetUrl } from "../http/assets";
import type { PlayerContext } from "../http/currentPlayer";
import type { Flash, User } from "../types";
import type { PlayerRecord } from "../repos/players";
import { formatDateTime, formatRelative } from "./format";
import { CheckIcon, ChevronDownIcon, CloseIcon, GearIcon, LogOutIcon, RefreshIcon } from "./icons";

export type NavKey = "dashboard" | "battles" | "collection" | "decks" | "settings";

export const NAV_HREF: Record<NavKey, string> = {
  dashboard: "/",
  battles: "/battles",
  collection: "/collection",
  decks: "/decks",
  settings: "/settings",
};

// Settings lives in the header's gear button, not here.
const NAV: { key: NavKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "battles", label: "Battles" },
  { key: "collection", label: "Collection" },
  { key: "decks", label: "Decks" },
];

export const APP_NAME = "CR Companion";

export interface LayoutProps {
  title: string;
  user: User | null;
  flash?: Flash | null;
  active?: NavKey;
  /** Linked players for the header switcher; null when signed out. */
  players?: PlayerContext | null;
  /** Where the switcher and sync button send the browser back to. */
  next?: string;
  /** Seconds left on the current player's manual-sync cooldown. */
  syncWait?: number;
  children?: Child;
}

const SYNC_READY_LABEL = "Sync Now";

/** A plain POST form, so it works without JS; app.js adds the spinner and the cooldown countdown. */
function SyncControl({ player, wait, next }: { player: PlayerRecord; wait: number; next: string }) {
  const label = wait > 0 ? `Sync available in ${wait}s` : SYNC_READY_LABEL;
  const failed = player.lastSyncError !== null;
  return (
    <form method="post" action={`/players/${tagSlug(player.tag)}/sync`} class="sync-form">
      <input type="hidden" name="next" value={next} />
      {player.lastSyncedAt ? (
        <time
          id="sync-time"
          class={`sync-time${failed ? " sync-failed" : ""}`}
          datetime={player.lastSyncedAt}
          title={`Last synced ${formatDateTime(player.lastSyncedAt)}${failed ? `. Last attempt failed: ${player.lastSyncError}` : ""}`}
        >
          {formatRelative(player.lastSyncedAt)}
        </time>
      ) : (
        <span id="sync-time" class={`sync-time${failed ? " sync-failed" : ""}`} title={failed ? `Sync failed: ${player.lastSyncError}` : "Never synced"}>
          never
        </span>
      )}
      <button
        type="submit"
        class="icon-btn sync-btn"
        aria-label={label}
        title={label}
        aria-describedby="sync-time"
        disabled={wait > 0}
        data-retry-after={wait > 0 ? String(wait) : undefined}
        data-ready-label={SYNC_READY_LABEL}
      >
        <RefreshIcon />
      </button>
    </form>
  );
}

/**
 * <details> keeps the menu usable without JS; app.js layers on the menu-button semantics (roles,
 * aria-expanded, arrow keys, Esc and outside-click close) that only hold once it runs.
 */
function PlayerMenu({ ctx, username, next }: { ctx: PlayerContext; username: string; next: string }) {
  const { players, current } = ctx;
  if (!current) {
    return (
      <a class="player-trigger" href="/settings#players" title={`Signed in as ${username}`}>
        <span class="player-trigger-name">Add a Player</span>
      </a>
    );
  }
  return (
    <details class="player-menu">
      <summary class="player-trigger" title={`${current.name || current.tag} ${current.tag}`}>
        <span class="sr-only">Player: </span>
        <span class="player-trigger-name">{current.name || current.tag}</span>
        <span class="player-trigger-tag">{current.tag}</span>
        <ChevronDownIcon />
      </summary>
      <div class="menu" aria-label="Switch player">
        <form method="post" action="/players/current">
          <input type="hidden" name="next" value={next} />
          {players.map((p) => {
            const selected = p.tag === current.tag;
            return (
              <button
                type="submit"
                name="tag"
                value={tagSlug(p.tag)}
                class="menu-item"
                aria-current={selected ? "true" : undefined}
                data-menu-item="radio"
              >
                <span class="menu-item-text">
                  <span class="menu-item-name">{p.name || p.tag}</span>
                  <span class="menu-item-tag">{p.tag}</span>
                </span>
                {selected && <CheckIcon />}
              </button>
            );
          })}
        </form>
        <hr class="menu-sep" />
        <p class="menu-note">
          Signed in as <strong>{username}</strong>
        </p>
        <a class="menu-item" href="/settings#players" data-menu-item="link">
          Manage Players
        </a>
      </div>
    </details>
  );
}

export function Layout({ title, user, flash, active, players, next = "/", syncWait = 0, children }: LayoutProps) {
  return (
    <>
      {raw("<!doctype html>")}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="dark" />
          <title>{`${title} · ${APP_NAME}`}</title>
          <link rel="icon" href={assetUrl("favicon.ico")} sizes="any" />
          <link rel="icon" type="image/png" href={assetUrl("favicon-32.png")} sizes="32x32" />
          <link rel="apple-touch-icon" href={assetUrl("apple-touch-icon.png")} />
          <link rel="stylesheet" href={assetUrl("app.css")} />
          <script src={assetUrl("app.js")} defer></script>
        </head>
        <body>
          <header class="topbar">
            <a class="brand" href="/" aria-label={APP_NAME}>
              <img class="brand-logo" src={assetUrl("logo-64.png")} alt="" width="28" height="28" />
              <span>
                CR<span class="brand-rest"> Companion</span>
              </span>
            </a>
            {user && (
              <nav class="nav" aria-label="Main">
                {NAV.map((n) => (
                  <a
                    href={NAV_HREF[n.key]}
                    class={n.key === active ? "active" : undefined}
                    aria-current={n.key === active ? "page" : undefined}
                  >
                    {n.label}
                  </a>
                ))}
              </nav>
            )}
            <div class="account">
              {user ? (
                <>
                  {players?.current && <SyncControl player={players.current} wait={syncWait} next={next} />}
                  {players && <PlayerMenu ctx={players} username={user.username} next={next} />}
                  <a
                    href="/settings"
                    class={`icon-btn${active === "settings" ? " active" : ""}`}
                    aria-label="Settings"
                    title="Settings"
                    aria-current={active === "settings" ? "page" : undefined}
                  >
                    <GearIcon />
                  </a>
                  {/* Logout is POST so a cross-site link can't sign the user out. */}
                  <form method="post" action="/logout" class="logout-form">
                    <button type="submit" class="icon-btn" aria-label="Log Out" title="Log Out">
                      <LogOutIcon />
                    </button>
                  </form>
                </>
              ) : (
                <a class="btn btn-secondary btn-small" href="/login">
                  Log In
                </a>
              )}
            </div>
          </header>
          <main class="container">
            {flash && !flash.target && (
              <div class={`flash flash-${flash.type}`} role="status">
                {flash.message}
              </div>
            )}
            {children}
          </main>
          {user && (
            // Only app.js opens this (battle rows); without JS rows are plain links to the detail page.
            <template id="battle-modal-template">
              <dialog class="modal" aria-labelledby="battle-detail-title" aria-label="Battle details">
                <div class="modal-head">
                  <span class="modal-title">Battle</span>
                  <div class="spacer" />
                  <a class="btn btn-ghost btn-small modal-full" href="#">
                    Open Full Page
                  </a>
                  <button type="button" class="icon-btn modal-close" aria-label="Close" title="Close">
                    <CloseIcon />
                  </button>
                </div>
                <div class="modal-body" tabindex={-1} autofocus></div>
              </dialog>
            </template>
          )}
        </body>
      </html>
    </>
  );
}
