import { existsSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { PasswordPolicyError } from "../auth/passwordPolicy";
import { createAdminToken, listAdminTokens, revokeAdminToken } from "../auth/adminTokens";
import { createInvite, listInvites, revokeInvite } from "../auth/invites";
import { createUser, getUserByUsername, listUsers, renameUser, setPassword } from "../auth/users";
import { config } from "../config";
import { getCrClient } from "../cr/client";
import { normalizeTag } from "../cr/tag";
import { getDb, migrate } from "../db";
import { getPlayer, listAllPlayers } from "../repos/players";
import { syncAll, syncPlayer } from "../sync";
import { pruneSnapshots } from "../sync/retention";

const USAGE = `Usage: bun run cli <command> [options]

Commands:
  migrate                                   Apply pending database migrations
  invite create [--max-uses N] [--days N]   Create an invite code (default: 1 use, expires in 7 days;
                [--no-expiry]               --days 0 or --no-expiry for an invite that never expires)
  invite list                               List invites
  invite revoke <id>                        Revoke an invite
  user list                                 List users
  user create <username> <password>         Create a user without an invite
  user set-password <username> <password>   Reset a user's password
  user rename <old> <new>                   Change a username (sessions and API keys keep working)
  admin-token create [--name <name>]        Create a token for /api/admin/* (printed once)
  admin-token list                          List admin tokens, including revoked ones
  admin-token revoke <id>                   Revoke an admin token
  player list                               List tracked players with owner and last sync
  sync <tag>                                Sync one tracked player now (ignores the cooldown)
  sync --all                                Sync every tracked player now
  snapshot prune                            Apply opt-in snapshot thinning (SNAPSHOT_KEEP_*; 0 = off)
  stats                                     Row counts per table and database file size

Options:
  -h, --help                                Show this help

Write tags without "#" (the shell treats "#..." as a comment), e.g. sync 9QJUGC2R.
Reads DATABASE_PATH and SNAPSHOT_KEEP_* from the environment; sync also needs CR_API_TOKEN
(and CR_API_BASE when using a proxy or the mock API).`;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function printStats(): void {
  const db = getDb();
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  console.table(
    tables.map(({ name }) => ({
      table: name,
      rows: db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM "${name}"`).get()!.n,
    })),
  );
  const path = config.DATABASE_PATH;
  if (path === ":memory:") return;
  // WAL mode keeps recent writes in the -wal file until a checkpoint, so the main file alone undercounts.
  for (const file of [path, `${path}-wal`]) {
    if (existsSync(file)) console.log(`${file}: ${formatBytes(statSync(file).size)}`);
  }
}


async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "max-uses": { type: "string" },
      days: { type: "string" },
      "no-expiry": { type: "boolean" },
      all: { type: "boolean" },
      name: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, sub, ...rest] = positionals;
  if (values.help || !cmd) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }

  migrate(getDb());

  // `sync` takes a free-form tag as its second word, so it can't be part of the switch key.
  switch (cmd === "sync" ? "sync" : `${cmd} ${sub ?? ""}`.trim()) {
    case "migrate":
      console.log("Migrations up to date.");
      return 0;
    case "invite create": {
      const maxUses = values["max-uses"] ? Number(values["max-uses"]) : 1;
      // Same 7-day default as POST /api/admin/invites.
      const days = values["no-expiry"] ? 0 : values.days !== undefined ? Number(values.days) : 7;
      if (!Number.isInteger(maxUses) || maxUses < 1) throw new Error("--max-uses must be a positive integer");
      if (!(days >= 0)) throw new Error("--days must be 0 (never expires) or positive");
      const invite = createInvite({ maxUses, expiresInDays: days === 0 ? undefined : days });
      console.log(invite.code);
      console.error(`max uses: ${invite.maxUses}, expires: ${invite.expiresAt ?? "never"}`);
      return 0;
    }
    case "invite list":
      console.table(listInvites());
      return 0;
    case "invite revoke": {
      const id = Number(rest[0]);
      if (!Number.isInteger(id)) throw new Error("invite revoke <id>");
      console.log(revokeInvite(id) ? "Revoked." : "No active invite with that id.");
      return 0;
    }
    case "user list":
      console.table(listUsers());
      return 0;
    case "user create": {
      const [username, password] = rest;
      if (!username || !password) throw new Error("user create <username> <password>");
      const user = await createUser(username, password);
      console.log(`Created user ${user.username} (id ${user.id}).`);
      return 0;
    }
    case "user set-password": {
      const [username, password] = rest;
      if (!username || !password) throw new Error("user set-password <username> <password>");
      const user = getUserByUsername(username);
      if (!user) throw new Error(`No user named ${username}`);
      await setPassword(user.id, password);
      console.log(`Password updated for ${user.username}.`);
      return 0;
    }
    case "user rename": {
      const [from, to] = rest;
      if (!from || !to) throw new Error("user rename <old> <new>");
      const user = getUserByUsername(from.toLowerCase());
      if (!user) throw new Error(`No user named ${from}`);
      const renamed = renameUser(user.id, to);
      console.log(`Renamed ${user.username} to ${renamed.username}.`);
      return 0;
    }
    case "admin-token create": {
      const name = values.name?.trim() || "admin";
      const { raw, record } = createAdminToken(name);
      console.log(raw);
      console.error(`Admin token "${record.name}" (id ${record.id}). Store it now: it cannot be shown again.`);
      return 0;
    }
    case "admin-token list": {
      const tokens = listAdminTokens({ includeRevoked: true });
      if (!tokens.length) {
        console.log("No admin tokens yet.");
        return 0;
      }
      console.table(
        tokens.map((t) => ({
          id: t.id,
          name: t.name,
          prefix: t.tokenPrefix,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt ?? "never",
          revokedAt: t.revokedAt ?? "",
        })),
      );
      return 0;
    }
    case "admin-token revoke": {
      const id = Number(rest[0]);
      if (!Number.isInteger(id)) throw new Error("admin-token revoke <id>");
      console.log(revokeAdminToken(id) ? "Revoked." : "No active admin token with that id.");
      return 0;
    }
    case "player list": {
      const owners = new Map(listUsers().map((u) => [u.id, u.username]));
      const players = listAllPlayers();
      if (!players.length) {
        console.log("No players tracked yet.");
        return 0;
      }
      console.table(
        players.map((p) => ({
          tag: p.tag,
          name: p.name,
          owner: owners.get(p.userId) ?? `#${p.userId}`,
          lastSyncedAt: p.lastSyncedAt ?? "never",
          lastSyncError: p.lastSyncError ?? "",
        })),
      );
      return 0;
    }
    case "sync": {
      if (values.all) {
        const r = await syncAll(getCrClient());
        console.log(
          `Synced ${r.players} players: ${r.failed} failed, ${r.skipped} skipped, ${r.battlesAdded} new battles, ${r.snapshotsInserted} changed snapshots.` +
            (r.rateLimited ? " Stopped early: rate limited." : ""),
        );
        return r.failed || r.rateLimited ? 1 : 0;
      }
      if (!sub) throw new Error("sync <tag> | sync --all");
      const tag = normalizeTag(sub);
      if (!getPlayer(tag)) throw new Error(`${tag} is not tracked. Link it from the web UI first.`);
      const r = await syncPlayer(tag, getCrClient());
      if (r.error) {
        console.error(`Sync failed for ${tag}: ${r.error}`);
        return 1;
      }
      console.log(`Synced ${tag}: ${r.battlesAdded} new battles, ${r.snapshotInserted ? "new snapshot" : "snapshot unchanged"}.`);
      return 0;
    }
    case "snapshot prune": {
      const policy = { keepAllDays: config.SNAPSHOT_KEEP_ALL_DAYS, keepDailyDays: config.SNAPSHOT_KEEP_DAILY_DAYS };
      const r = pruneSnapshots(policy);
      const days = (n: number) => (n > 0 ? `${n} days` : "off");
      console.log(
        policy.keepAllDays > 0 || policy.keepDailyDays > 0
          ? `Deleted ${r.deleted} snapshots, ${r.remaining} remain ` +
              `(keep all ${days(policy.keepAllDays)}, daily ${days(policy.keepDailyDays)}).`
          : `Snapshot thinning is off (SNAPSHOT_KEEP_* are 0); kept all ${r.remaining} snapshots.`,
      );
      return 0;
    }
    case "stats":
      printStats();
      return 0;
    default:
      console.error(`Unknown command: ${positionals.join(" ")}\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof PasswordPolicyError) {
      console.error(["Password rejected:", ...err.problems.map((p) => `  - ${p.message}`)].join("\n"));
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exit(1);
  },
);
