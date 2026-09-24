import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import type { Flash, User } from "../types";

export type NavKey = "dashboard" | "battles" | "collection" | "decks" | "settings";

const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "battles", label: "Battles", href: "/battles" },
  { key: "collection", label: "Collection", href: "/collection" },
  { key: "decks", label: "Decks", href: "/decks" },
  { key: "settings", label: "Settings", href: "/settings" },
];

export const APP_NAME = "CR Companion";

export interface LayoutProps {
  title: string;
  user: User | null;
  flash?: Flash | null;
  active?: NavKey;
  children?: Child;
}

export function Layout({ title, user, flash, active, children }: LayoutProps) {
  return (
    <>
      {raw("<!doctype html>")}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="dark" />
          <title>{`${title} · ${APP_NAME}`}</title>
          <link rel="stylesheet" href="/static/app.css" />
          <script src="/static/app.js" defer></script>
        </head>
        <body>
          <header class="topbar">
            <a class="brand" href="/">
              {APP_NAME}
            </a>
            {user && (
              <nav class="nav">
                {NAV.map((n) => (
                  <a href={n.href} class={n.key === active ? "active" : undefined}>
                    {n.label}
                  </a>
                ))}
              </nav>
            )}
            <div class="account">
              {user ? (
                <>
                  <span class="muted">{user.username}</span>
                  {/* Logout is POST so a cross-site link can't sign the user out. */}
                  <form method="post" action="/logout" class="inline">
                    <button type="submit" class="btn-link">
                      Log out
                    </button>
                  </form>
                </>
              ) : (
                <a href="/login">Log in</a>
              )}
            </div>
          </header>
          <main class="container">
            {flash && (
              <div class={`flash flash-${flash.type}`} role="status">
                {flash.message}
              </div>
            )}
            {children}
          </main>
        </body>
      </html>
    </>
  );
}
