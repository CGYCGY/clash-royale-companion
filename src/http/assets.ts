import type { MiddlewareHandler } from "hono";
import { serveStatic } from "hono/bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC_DIR = join(import.meta.dir, "..", "..", "public");
const IMMUTABLE = "public, max-age=31536000, immutable";

const hashes = new Map<string, string | null>();

// Files are read once per process: a deploy restarts the server, which is exactly when hashes change.
function assetHash(file: string): string | null {
  if (!hashes.has(file)) {
    let hash: string | null = null;
    try {
      hash = new Bun.CryptoHasher("sha1").update(readFileSync(join(PUBLIC_DIR, file))).digest("hex").slice(0, 10);
    } catch {
      // A missing file still gets a URL; the request then 404s like any other.
    }
    hashes.set(file, hash);
  }
  return hashes.get(file)!;
}

/**
 * URL for a file in public/, versioned by content hash. Cloudflare in front of the app caches static
 * files by full URL, so a changed file must get a new URL or browsers keep the old copy for hours.
 */
export function assetUrl(file: string): string {
  const hash = assetHash(file);
  return hash ? `/static/${file}?v=${hash}` : `/static/${file}`;
}

/**
 * Serves /static/*. Only a request whose `v` matches the current content is cacheable forever; an
 * unversioned or stale `v` (a page rendered before a deploy) must revalidate so no cache pins it.
 */
export const staticAssets = (): MiddlewareHandler =>
  serveStatic({
    root: PUBLIC_DIR,
    rewriteRequestPath: (p) => p.replace(/^\/static/, ""),
    onFound: (_path, c) => {
      const v = c.req.query("v");
      const fresh = v !== undefined && v === assetHash(c.req.path.replace(/^\/static\//, ""));
      c.header("Cache-Control", fresh ? IMMUTABLE : "no-cache");
    },
  });

/**
 * Pages are per-user (session, flash, current player), so no shared cache may store them. Responses
 * that already chose a Cache-Control (the battle dialog partial) keep theirs.
 */
export const noSharedCacheForHtml: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.headers.get("Content-Type")?.startsWith("text/html") && !c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "private, no-cache");
  }
};
