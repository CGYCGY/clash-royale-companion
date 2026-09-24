import type { Hono } from "hono";
import type { AppEnv } from "../types";
import { adminRoutes } from "./api/admin";
import { cardRoutes } from "./api/cards";
import { deckRoutes } from "./api/decks";
import { healthRoutes } from "./api/health";
import { keyRoutes } from "./api/keys";
import { meRoutes } from "./api/me";
import { playerRoutes } from "./api/players";
import { authPages } from "./pages/auth";
import { battlePages } from "./pages/battles";
import { collectionPages } from "./pages/collection";
import { dashboardPages } from "./pages/dashboard";
import { deckPages } from "./pages/decks";
import { settingsPages } from "./pages/settings";

/**
 * Single place where routers are mounted. Add one import + one app.route() line per router.
 *   API routers:  src/routes/api/<name>.ts   export `<name>Routes`, mounted under "/api"
 *   Page routers: src/routes/pages/<name>.tsx export `<name>Pages`, mounted under "/"
 * Routers declare their own auth middleware, scoped to their own paths: an unscoped .use() in a
 * sub-app also runs for every router mounted at the same prefix after it.
 */
export function registerRoutes(app: Hono<AppEnv>): void {
  app.route("/api", healthRoutes);
  app.route("/api", meRoutes);
  app.route("/api", playerRoutes);
  app.route("/api", deckRoutes);
  app.route("/api", cardRoutes);
  app.route("/api", keyRoutes);
  app.route("/api", adminRoutes);
  app.route("/", authPages);
  app.route("/", dashboardPages);
  app.route("/", battlePages);
  app.route("/", collectionPages);
  app.route("/", deckPages);
  app.route("/", settingsPages);
}
