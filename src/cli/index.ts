import { existsSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { createInvite, listInvites, revokeInvite } from "../auth/invites";
import { createUser, listUsers, setPassword, getUserByUsername } from "../auth/users";
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
  player list                               List tracked players with owner and last sync
  sync <tag>                                Sync one tracked player now (ignores the cooldown)
  sync --all                                Sync every tracked player now
  snapshot prune                            Apply snapshot retention now and print counts
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
          `Synced ${r.players} players: ${r.failed} failed, ${r.skipped} skipped, ${r.battlesAdded} new battles.` +
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
      console.log(`Synced ${tag}: ${r.battlesAdded} new battles.`);
      return 0;
    }
    case "snapshot prune": {
      const policy = { keepAllDays: config.SNAPSHOT_KEEP_ALL_DAYS, keepDailyDays: config.SNAPSHOT_KEEP_DAILY_DAYS };
      const r = pruneSnapshots(policy);
      console.log(
        `Deleted ${r.deleted} snapshots, ${r.remaining} remain ` +
          `(keep all ${policy.keepAllDays} days, daily ${policy.keepDailyDays} days).`,
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
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
