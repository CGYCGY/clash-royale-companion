import { Hono } from "hono";
import { indexedImage } from "../cardImages";
import type { AppEnv } from "../types";

const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Card art at /cards/<file>. Mounted in createApp before csrf/authenticate, not in registerRoutes, so
 * image requests never touch the session table. Only indexed names are served: the index is the
 * allowlist, so a crafted name can never reach the filesystem.
 */
export const cardImageRoutes = new Hono<AppEnv>().get("/cards/:file", async (c) => {
  const hit = indexedImage(c.req.param("file"));
  const file = hit && Bun.file(hit.path);
  // The index is only rebuilt on a scan, so a file removed since then must 404 rather than throw.
  if (!hit || !file || !(await file.exists())) return c.text("Not Found", 404);
  return new Response(file, {
    headers: {
      "Content-Type": "image/png",
      // Same rule as /static: only the current version may be pinned, so a refreshed file isn't shadowed.
      "Cache-Control": c.req.query("v") === hit.version ? IMMUTABLE : "no-cache",
    },
  });
});
