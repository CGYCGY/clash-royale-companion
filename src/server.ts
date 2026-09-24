import { createApp } from "./app";
import { config, requireEnv } from "./config";
import { getCrClient } from "./cr/client";
import { closeDatabase, getDb, migrate } from "./db";
import { countCards } from "./repos/cards";
import { countEvents } from "./repos/events";
import { startScheduler, syncCards, syncEvents } from "./sync";

requireEnv("CR_API_TOKEN");

const applied = migrate(getDb());
if (applied.length) console.log(`[db] applied migrations: ${applied.join(", ")}`);

const client = getCrClient();

if (countCards() === 0) {
  // Not awaited: the server should come up even if the API is unreachable at boot.
  syncCards(client)
    .then((n) => console.log(`[startup] card catalog loaded (${n} cards)`))
    .catch((err: unknown) =>
      console.error("[startup] card catalog sync failed:", err instanceof Error ? err.message : err),
    );
}

if (countEvents() === 0) {
  syncEvents(client)
    .then((n) => console.log(`[startup] event titles loaded (${n})`))
    .catch((err: unknown) => console.error("[startup] events sync failed:", err instanceof Error ? err.message : err));
}

const scheduler = startScheduler(client);
const app = createApp();
const server = Bun.serve({ port: config.PORT, fetch: app.fetch });
console.log(`[server] listening on http://localhost:${server.port}`);

function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down`);
  scheduler.stop();
  server.stop();
  closeDatabase();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
