// Serves test/fixtures at the real Clash Royale API paths so the app runs without a Supercell key:
//   bun run mock-api
//   CR_API_BASE=http://localhost:8787/v1 CR_API_TOKEN=dev bun run dev
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.MOCK_CR_PORT ?? 8787);
const FIXTURES = join(import.meta.dir, "..", "test", "fixtures");

const load = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

// Same body shape as the real API's errors, which CrClient reads `reason` and `message` from.
const apiError = (status: number, reason: string, message: string) =>
  Response.json({ reason, message }, { status });

function route(path: string): Response {
  if (path === "/v1/cards") return Response.json(load("cards"));
  const m = /^\/v1\/players\/([^/]+)(?:\/(battlelog|upcomingchests))?\/?$/.exec(path);
  if (!m) return apiError(404, "notFound", `No mock for ${path}`);
  const tag = decodeURIComponent(m[1]!).toUpperCase();
  if (!tag.startsWith("#")) return apiError(404, "notFound", "Tag must be URL-encoded with %23");
  switch (m[2]) {
    case "battlelog":
      return Response.json(load("battlelog"));
    case "upcomingchests":
      return Response.json(load("chests"));
    default:
      return Response.json({ ...(load("player") as object), tag });
  }
}

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    const auth = req.headers.get("authorization") ?? "";
    if (!/^Bearer \S+/.test(auth)) {
      return apiError(403, "accessDenied", "Invalid authorization");
    }
    const res = route(url.pathname);
    console.log(`${req.method} ${url.pathname} ${res.status}`);
    return res;
  },
});

console.log(`[mock-cr-api] http://localhost:${server.port}/v1 (any tag, any Bearer token)`);
