import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

let current: Database | null = null;

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  // strict: named params bind without the `$` prefix and missing params throw instead of binding NULL.
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  return db;
}

/** The shared connection, opened lazily from DATABASE_PATH on first use. */
export function getDb(): Database {
  current ??= openDatabase(config.DATABASE_PATH);
  return current;
}

/** Swap the shared connection (tests use an in-memory DB). Pass null to reset. */
export function setDatabase(db: Database | null): void {
  current = db;
}

export function closeDatabase(): void {
  current?.close();
  current = null;
}

/** Applies pending `NNNN_name.sql` files in order, each in its own transaction. Returns applied names. */
export function migrate(db: Database = getDb()): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    db.query<{ name: string }, []>("SELECT name FROM schema_migrations").all().map((r) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        file,
        new Date().toISOString(),
      );
    })();
    ran.push(file);
  }
  return ran;
}
