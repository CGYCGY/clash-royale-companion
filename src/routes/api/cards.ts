import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../../auth/middleware";
import { parseQuery } from "../../http/validate";
import { listCards } from "../../repos/cards";
import type { AppEnv } from "../../types";

export const cardRoutes = new Hono<AppEnv>().get("/cards", requireUser, (c) => {
  const { kind } = parseQuery(c, z.object({ kind: z.enum(["card", "support"]).optional() }));
  return c.json({ cards: listCards({ kind }) });
});
