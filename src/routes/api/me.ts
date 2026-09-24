import { Hono } from "hono";
import { currentUser, requireUser } from "../../auth/middleware";
import { listPlayersForUser } from "../../repos/players";
import type { AppEnv } from "../../types";

export const meRoutes = new Hono<AppEnv>().get("/me", requireUser, (c) => {
  const user = currentUser(c);
  return c.json({
    user: { id: user.id, username: user.username, createdAt: user.createdAt },
    authMethod: c.var.authMethod,
    players: listPlayersForUser(user.id),
  });
});
