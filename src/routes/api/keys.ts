import { Hono } from "hono";
import { z } from "zod";
import { createApiKey, listApiKeys, revokeApiKey } from "../../auth/apiKeys";
import { currentUser, requireSession } from "../../auth/middleware";
import { notFound } from "../../errors";
import { parseJson, parseWith } from "../../http/validate";
import type { AppEnv } from "../../types";

// Session only: an API key must not be able to mint or revoke keys.
export const keyRoutes = new Hono<AppEnv>()
  .use("/keys/*", requireSession)
  .get("/keys", (c) => c.json({ keys: listApiKeys(currentUser(c).id) }))
  .post("/keys", async (c) => {
    const { name } = await parseJson(c, z.object({ name: z.string().trim().min(1).max(60) }));
    const { raw, record } = createApiKey(currentUser(c).id, name);
    return c.json({ key: { ...record, raw } }, 201);
  })
  .delete("/keys/:id", (c) => {
    const id = parseWith(z.coerce.number().int().positive(), c.req.param("id"));
    if (!revokeApiKey(currentUser(c).id, id)) throw notFound("API key");
    return c.body(null, 204);
  });
