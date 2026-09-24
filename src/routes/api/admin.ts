import { type Context, Hono } from "hono";
import { z } from "zod";
import { createInvite, isInviteUsable, listInvites, revokeInvite } from "../../auth/invites";
import { requireAdmin } from "../../auth/middleware";
import { listUsers } from "../../auth/users";
import { getCrClient } from "../../cr/client";
import { AppError, notFound } from "../../errors";
import { parseQuery, parseWith } from "../../http/validate";
import { listAllPlayers } from "../../repos/players";
import { listRecentSyncRuns } from "../../repos/syncRuns";
import { syncAll } from "../../sync";
import type { AppEnv } from "../../types";

/** Admin clients (curl, the CLI) often POST with no body; treat that as `{}`. */
async function optionalJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("bad_request", "Request body must be valid JSON");
  }
}

const inviteSchema = z.object({
  maxUses: z.number().int().min(1).max(100).default(1),
  expiresInDays: z.number().int().min(1).max(365).default(7),
});

// The scheduler's overlap guard (croner `protect`) is private to its job, so admin-triggered
// runs only guard against each other.
let adminSync: Promise<void> | null = null;

/** The in-flight admin-triggered sync, if any. Exposed for tests. */
export const currentAdminSync = (): Promise<void> | null => adminSync;

export const adminRoutes = new Hono<AppEnv>()
  .use("/admin/*", requireAdmin)
  .post("/admin/invites", async (c) => {
    const opts = parseWith(inviteSchema, await optionalJson(c));
    const invite = createInvite(opts);
    return c.json({ invite: { ...invite, usable: isInviteUsable(invite) } }, 201);
  })
  .get("/admin/invites", (c) =>
    c.json({ invites: listInvites().map((i) => ({ ...i, usable: isInviteUsable(i) })) }),
  )
  .delete("/admin/invites/:id", (c) => {
    const id = parseWith(z.coerce.number().int().positive(), c.req.param("id"));
    if (!revokeInvite(id)) throw notFound("Invite");
    return c.body(null, 204);
  })
  .get("/admin/users", (c) => {
    const tagsByUser = new Map<number, string[]>();
    for (const p of listAllPlayers()) tagsByUser.set(p.userId, [...(tagsByUser.get(p.userId) ?? []), p.tag]);
    return c.json({
      users: listUsers().map((u) => ({
        id: u.id,
        username: u.username,
        createdAt: u.createdAt,
        players: tagsByUser.get(u.id) ?? [],
      })),
    });
  })
  .get("/admin/sync-runs", (c) => {
    const { limit } = parseQuery(c, z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }));
    return c.json({ runs: listRecentSyncRuns({ limit }) });
  })
  .post("/admin/sync", (c) => {
    if (adminSync) throw new AppError("conflict", "A sync is already running", 409);
    const client = getCrClient();
    adminSync = syncAll(client)
      .then((r) => console.log(`[admin] synced ${r.players} players (${r.failed} failed, ${r.skipped} skipped, ${r.battlesAdded} battles, ${r.snapshotsInserted} changed snapshots)`))
      .catch((err: unknown) => console.error("[admin] sync failed:", err))
      .finally(() => {
        adminSync = null;
      });
    return c.json({ started: true }, 202);
  });
