import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createApiKey, listApiKeys, revokeApiKey } from "../../auth/apiKeys";
import { currentUser, requireSession } from "../../auth/middleware";
import { deleteSessionsForUser, startSession } from "../../auth/sessions";
import { setPassword, verifyCredentials } from "../../auth/users";
import { config, isSecureCookie } from "../../config";
import { normalizeTag, tagSlug } from "../../cr/tag";
import { notFound } from "../../errors";
import { setFlash } from "../../http/flash";
import { parseForm } from "../../http/validate";
import { getNotes, setNotes } from "../../repos/notes";
import { assertPlayerOwnedBy, listPlayersForUser, removePlayer } from "../../repos/players";
import { trackPlayer } from "../../sync";
import type { AppEnv } from "../../types";
import { Table } from "../../views/components";
import { formatDateTime, formatRelative } from "../../views/format";
import { renderPage } from "../../views/render";
import { formError, idParam, text } from "./shared";

// The raw key rides a one-shot cookie (like the flash) so it survives the PRG redirect without being
// stored server-side; it's scoped to /settings and deleted on the next render.
const NEW_KEY_COOKIE = "cr_newkey";
const RAW_KEY_RE = /^crk_[A-Za-z0-9_-]+$/;

function apiBaseUrl(c: Context): string {
  const origin = config.APP_URL ? config.APP_URL.replace(/\/+$/, "") : new URL(c.req.url).origin;
  return `${origin}/api`;
}

function takeNewKey(c: Context): string | null {
  const raw = getCookie(c, NEW_KEY_COOKIE);
  if (!raw) return null;
  deleteCookie(c, NEW_KEY_COOKIE, { path: "/settings", secure: isSecureCookie() });
  return RAW_KEY_RE.test(raw) ? raw : null;
}

type FormErrors = Partial<Record<"player" | "key" | "password", string>>;

function ErrorText({ message }: { message?: string }) {
  return message ? (
    <p class="error-text" role="alert">
      {message}
    </p>
  ) : null;
}

function renderSettings(c: Context<AppEnv>, errors: FormErrors = {}, status: 200 | 400 = 200) {
  const user = currentUser(c);
  const players = listPlayersForUser(user.id);
  const keys = listApiKeys(user.id);
  const newKey = takeNewKey(c);
  const base = apiBaseUrl(c);

  return renderPage(
    c,
    { title: "Settings", active: "settings", status },
    <div class="stack">
      <h1>Settings</h1>

      <section class="card" id="players">
        <h2>Linked players</h2>
        <Table
          columns={[
            { label: "Name", render: (p) => p.name || <span class="muted">unknown</span> },
            { label: "Tag", render: (p) => <code>{p.tag}</code> },
            {
              label: "Last synced",
              render: (p) =>
                p.lastSyncedAt ? (
                  <span title={formatDateTime(p.lastSyncedAt)}>{formatRelative(p.lastSyncedAt)}</span>
                ) : (
                  <span class="muted">never</span>
                ),
            },
            {
              label: "Last error",
              render: (p) => (p.lastSyncError ? <span class="error-text">{p.lastSyncError}</span> : <span class="muted">–</span>),
            },
            {
              label: "",
              align: "right",
              render: (p) => (
                <form
                  method="post"
                  action={`/settings/players/${tagSlug(p.tag)}/remove`}
                  class="inline"
                  onsubmit={`return confirm(${JSON.stringify(`Remove ${p.tag}? This deletes its stored battles, snapshots, and notes.`)})`}
                >
                  <button type="submit" class="btn-danger btn-small">
                    Remove
                  </button>
                </form>
              ),
            },
          ]}
          rows={players}
          empty="No players linked yet."
        />
        <form method="post" action="/settings/players" class="inline-form">
          <div class="field">
            <label for="tag">Add a player tag</label>
            <input type="text" id="tag" name="tag" placeholder="#9QJUGC2R" autocomplete="off" required />
          </div>
          <button type="submit">Add player</button>
        </form>
        <ErrorText message={errors.player} />
        <p class="help">Find your tag under your name in the in-game profile. The first sync runs right away.</p>
      </section>

      {players.length > 0 && (
        <section class="card" id="notes">
          <h2>Player notes</h2>
          <p class="help">Free text the AI will see: budget, pass status, goals, playstyle.</p>
          {players.map((p) => {
            const notes = getNotes(p.tag);
            return (
              <form method="post" action={`/settings/players/${tagSlug(p.tag)}/notes`} class="notes-form">
                <label for={`notes-${tagSlug(p.tag)}`}>
                  {p.name || p.tag} <span class="muted">{p.tag}</span>
                </label>
                <textarea id={`notes-${tagSlug(p.tag)}`} name="content" maxlength={20000}>
                  {notes?.content ?? ""}
                </textarea>
                <div class="row">
                  <button type="submit" class="btn-secondary">
                    Save notes
                  </button>
                  {notes && <span class="muted small">Updated {formatRelative(notes.updatedAt)}</span>}
                </div>
              </form>
            );
          })}
        </section>
      )}

      <section class="card" id="keys">
        <h2>API keys</h2>
        <p>
          Give this key to your AI assistant. Base URL: <code>{base}</code>
        </p>
        {newKey && (
          <div class="key-reveal" role="status">
            <p>
              <strong>New API key.</strong> Copy it now; it won't be shown again.
            </p>
            <code class="key-value" data-copy>
              {newKey}
            </code>
          </div>
        )}
        <Table
          columns={[
            { label: "Name", render: (k) => k.name },
            { label: "Prefix", render: (k) => <code>{k.keyPrefix}…</code> },
            { label: "Created", render: (k) => <span title={formatDateTime(k.createdAt)}>{formatRelative(k.createdAt)}</span> },
            {
              label: "Last used",
              render: (k) => (k.lastUsedAt ? formatRelative(k.lastUsedAt) : <span class="muted">never</span>),
            },
            {
              label: "",
              align: "right",
              render: (k) => (
                <form
                  method="post"
                  action={`/settings/keys/${k.id}/revoke`}
                  class="inline"
                  onsubmit={`return confirm(${JSON.stringify(`Revoke "${k.name}"? Anything using it stops working.`)})`}
                >
                  <button type="submit" class="btn-danger btn-small">
                    Revoke
                  </button>
                </form>
              ),
            },
          ]}
          rows={keys}
          empty="No API keys yet."
        />
        <form method="post" action="/settings/keys" class="inline-form">
          <div class="field">
            <label for="key-name">New key name</label>
            <input type="text" id="key-name" name="name" placeholder="e.g. Claude" maxlength={64} required />
          </div>
          <button type="submit">Create key</button>
        </form>
        <ErrorText message={errors.key} />
      </section>

      <section class="card" id="account">
        <h2>Account</h2>
        <p class="muted">Signed in as {user.username}.</p>
        <form method="post" action="/settings/password" class="form-narrow">
          <div class="field">
            <label for="current">Current password</label>
            <input type="password" id="current" name="current" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label for="new-password">New password</label>
            <input type="password" id="new-password" name="password" autocomplete="new-password" minlength={8} required />
          </div>
          <div class="field">
            <label for="confirm">Confirm new password</label>
            <input type="password" id="confirm" name="confirm" autocomplete="new-password" required />
          </div>
          <ErrorText message={errors.password} />
          <div class="field">
            <button type="submit">Change password</button>
          </div>
        </form>
      </section>
    </div>,
  );
}

export const settingsPages = new Hono<AppEnv>()
  .use("/settings/*", requireSession)
  .get("/settings", (c) => renderSettings(c))
  .post("/settings/players", async (c) => {
    try {
      const { tag } = await parseForm(c, z.object({ tag: text }));
      const r = await trackPlayer(currentUser(c).id, tag);
      const name = r.player.name || r.player.tag;
      if (r.syncError) setFlash(c, "info", `Added ${name}, but the first sync failed: ${r.syncError}`);
      else setFlash(c, "success", `Added ${name}. Synced ${r.battlesAdded} battles.`);
      return c.redirect("/settings");
    } catch (err) {
      const message = formError(err, {
        invalid_tag: "That doesn't look like a player tag. Tags use only the characters 0289PYLQGRJCUV.",
        not_found: "No Clash Royale player has that tag.",
        conflict: true,
        upstream_error: true,
      });
      return renderSettings(c, { player: message }, 400);
    }
  })
  .post("/settings/players/:tag/remove", (c) => {
    const tag = normalizeTag(c.req.param("tag"));
    if (!removePlayer(tag, currentUser(c).id)) throw notFound("Player");
    setFlash(c, "success", `Removed ${tag} and its stored data.`);
    return c.redirect("/settings");
  })
  .post("/settings/players/:tag/notes", async (c) => {
    const tag = normalizeTag(c.req.param("tag"));
    const player = assertPlayerOwnedBy(tag, currentUser(c).id);
    const { content } = await parseForm(c, z.object({ content: z.string().max(20_000).default("") }));
    setNotes(tag, content.replace(/\r\n/g, "\n"));
    setFlash(c, "success", `Saved notes for ${player.name || tag}.`);
    return c.redirect("/settings#notes");
  })
  .post("/settings/keys", async (c) => {
    try {
      const { name } = await parseForm(
        c,
        z.object({ name: z.string().trim().min(1, "Give the key a name").max(64, "Name is too long") }),
      );
      const { raw } = createApiKey(currentUser(c).id, name);
      setCookie(c, NEW_KEY_COOKIE, raw, {
        httpOnly: true,
        sameSite: "Strict",
        secure: isSecureCookie(),
        path: "/settings",
        maxAge: 60,
      });
      setFlash(c, "success", `Created API key "${name}".`);
      return c.redirect("/settings#keys");
    } catch (err) {
      return renderSettings(c, { key: formError(err) }, 400);
    }
  })
  .post("/settings/keys/:id/revoke", (c) => {
    if (!revokeApiKey(currentUser(c).id, idParam(c.req.param("id")))) throw notFound("API key");
    setFlash(c, "success", "API key revoked.");
    return c.redirect("/settings#keys");
  })
  .post("/settings/password", async (c) => {
    const user = currentUser(c);
    try {
      const form = await parseForm(c, z.object({ current: text, password: text, confirm: text }));
      if (form.password !== form.confirm) return renderSettings(c, { password: "New passwords don't match." }, 400);
      if (!(await verifyCredentials(user.username, form.current))) {
        return renderSettings(c, { password: "Current password is wrong." }, 400);
      }
      await setPassword(user.id, form.password);
      // Sign out every other browser; this one gets a fresh session.
      deleteSessionsForUser(user.id);
      startSession(c, user.id);
      setFlash(c, "success", "Password changed. Other sessions were signed out.");
      return c.redirect("/settings");
    } catch (err) {
      return renderSettings(c, { password: formError(err) }, 400);
    }
  });
