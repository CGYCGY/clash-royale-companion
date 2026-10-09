import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/sessions";
import {
  cardImageFile,
  hasOverride,
  indexedImage,
  refreshCardImageIndex,
  resolveCardIcon,
} from "../src/cardImages";
import { config } from "../src/config";
import { getCardById } from "../src/repos/cards";
import type { AppEnv } from "../src/types";
import { makeTestDb, seedCards } from "./helpers";

const SKELETON_ARMY = 26000012;
const originalDir = config.CARD_IMAGE_DIR;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "card-images-"));
  config.CARD_IMAGE_DIR = tmp;
  refreshCardImageIndex();
});

afterEach(() => {
  config.CARD_IMAGE_DIR = originalDir;
  refreshCardImageIndex();
  rmSync(tmp, { recursive: true, force: true });
});

describe("cardImages", () => {
  test("cardImageFile names files by id and form", () => {
    expect(cardImageFile(26000000, "base")).toBe("26000000.png");
    expect(cardImageFile(26000000, "evo")).toBe("26000000-evo.png");
    expect(cardImageFile(26000000, "hero")).toBe("26000000-hero.png");
  });

  test("resolveCardIcon prefers a local file and falls back to the official URL", () => {
    const version = indexedImage("26000012-evo.png")!.version;
    expect(resolveCardIcon(SKELETON_ARMY, "evo", "https://cdn/evo.png")).toBe(`/cards/26000012-evo.png?v=${version}`);
    expect(resolveCardIcon(SKELETON_ARMY, "base", "https://cdn/base.png")).toBe("https://cdn/base.png");
    expect(resolveCardIcon(SKELETON_ARMY, "hero", null)).toBeNull();
  });

  test("hasOverride only reports public/cards files", () => {
    writeFileSync(join(tmp, "26000000.png"), "png");
    refreshCardImageIndex();
    expect(hasOverride(SKELETON_ARMY, "evo")).toBe(true);
    expect(hasOverride(SKELETON_ARMY, "base")).toBe(false);
    expect(hasOverride(26000000, "base")).toBe(false);
  });

  test("the index rescans CARD_IMAGE_DIR and ignores names outside the pattern", () => {
    expect(indexedImage("26000000.png")).toBeUndefined();
    writeFileSync(join(tmp, "26000000.png"), "png");
    writeFileSync(join(tmp, "notes.txt"), "x");
    writeFileSync(join(tmp, "26000000-big.png"), "x");
    refreshCardImageIndex();
    expect(indexedImage("26000000.png")).toMatchObject({ source: "cache", path: join(tmp, "26000000.png") });
    expect(indexedImage("notes.txt")).toBeUndefined();
    expect(indexedImage("26000000-big.png")).toBeUndefined();
    expect(resolveCardIcon(26000000, "base", "https://cdn/x.png")).toStartWith("/cards/26000000.png?v=");
  });

  test("an override wins over a cached file of the same name", () => {
    writeFileSync(join(tmp, "26000012-evo.png"), "cached");
    refreshCardImageIndex();
    expect(indexedImage("26000012-evo.png")!.source).toBe("override");
  });

  test("CardRecord icons resolve while the DB keeps the official URL", () => {
    makeTestDb();
    seedCards();
    const card = getCardById(SKELETON_ARMY)!;
    expect(card.iconUrlEvo).toStartWith("/cards/26000012-evo.png?v=");
    expect(card.iconUrl).toStartWith("https://");
  });
});

describe("GET /cards/:file", () => {
  let app: Hono<AppEnv>;
  beforeEach(() => {
    makeTestDb();
    app = createApp();
  });

  test("serves an indexed image, immutable only for the current version", async () => {
    const { version } = indexedImage("26000012-evo.png")!;
    const fresh = await app.request(`/cards/26000012-evo.png?v=${version}`);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("content-type")).toBe("image/png");
    expect(fresh.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await fresh.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const bare = await app.request("/cards/26000012-evo.png");
    expect(bare.status).toBe(200);
    expect(bare.headers.get("cache-control")).toBe("no-cache");
    const stale = await app.request("/cards/26000012-evo.png?v=old");
    expect(stale.headers.get("cache-control")).toBe("no-cache");
  });

  test("serves files from CARD_IMAGE_DIR", async () => {
    writeFileSync(join(tmp, "26000000.png"), "png-bytes");
    refreshCardImageIndex();
    const res = await app.request("/cards/26000000.png");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png-bytes");
  });

  test("404s for unknown and path-traversal names", async () => {
    for (const path of [
      "/cards/99999999.png",
      "/cards/..%2Fpackage.json",
      "/cards/..%2F..%2Fpublic%2Fapp.css",
      "/cards/%2E%2E%2Fapp.css",
      "/cards/../package.json",
      "/cards/26000012-evo.png%00.txt",
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type") ?? "", path).not.toContain("image/png");
    }
  });

  test("404s when an indexed file was removed before the next scan", async () => {
    writeFileSync(join(tmp, "26000000.png"), "png");
    refreshCardImageIndex();
    rmSync(join(tmp, "26000000.png"));
    expect((await app.request("/cards/26000000.png")).status).toBe(404);
  });

  test("is answered before csrf and session lookup", async () => {
    // With the DB closed, a session lookup would throw and 500 the request.
    makeTestDb().close();
    const res = await app.request("/cards/26000012-evo.png", { headers: { Cookie: `${SESSION_COOKIE}=whatever` } });
    expect(res.status).toBe(200);
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const page = await app.request("/login", { headers: { Cookie: `${SESSION_COOKIE}=whatever` } });
    quiet.mockRestore();
    expect(page.status).toBe(500);
  });
});
