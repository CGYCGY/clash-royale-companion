import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshCardImageIndex, resolveCardIcon } from "../../src/cardImages";
import { config } from "../../src/config";
import type { CardsResponse } from "../../src/cr/types";
import { upsertCards } from "../../src/repos/cards";
import { cardImageCacheEmpty, syncCardImages } from "../../src/sync";
import { loadFixture, makeTestDb, seedCards } from "../helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const KNIGHT_BASE = "https://api-assets.clashroyale.com/cards/300/8c23b2b86573edf2a5ea48.png";
const ARCHERS_EVO = "https://api-assets.clashroyale.com/cardevolutions/300/7e711b383dabb834cc73b5.png";
const SKARMY_EVO = "https://api-assets.clashroyale.com/cardevolutions/300/skarmy-evo.png";

const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url === KNIGHT_BASE) return new Response("nope", { status: 404 });
  if (url === ARCHERS_EVO) return new Response("<html>cdn error</html>", { status: 200 });
  return new Response(PNG, { status: 200 });
}) as typeof fetch;

const originalDir = config.CARD_IMAGE_DIR;
let dir: string;

beforeEach(() => {
  makeTestDb();
  seedCards();
  // The fixture's Skeleton Army has no evo art; the live API ships one, which public/cards/ overrides.
  const skarmy = loadFixture<CardsResponse>("cards").items.find((c) => c.id === 26000012)!;
  upsertCards([{ ...skarmy, iconUrls: { ...skarmy.iconUrls, evolutionMedium: SKARMY_EVO } }]);
  dir = mkdtempSync(join(tmpdir(), "cr-card-images-"));
  config.CARD_IMAGE_DIR = dir;
  refreshCardImageIndex();
});

afterEach(() => {
  config.CARD_IMAGE_DIR = originalDir;
  refreshCardImageIndex();
  rmSync(dir, { recursive: true, force: true });
});

describe("syncCardImages", () => {
  test("downloads every form, skips overrides, keeps old files on failure, and refreshes the index", async () => {
    writeFileSync(join(dir, "26000000.png"), "old knight");
    expect(resolveCardIcon(26000001, "base", "https://official")).toBe("https://official");
    const logged = spyOn(console, "error").mockImplementation(() => {});

    const r = await syncCardImages({ fetchImpl: fakeFetch });

    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
    // 65 URLs in the fixture plus the injected Skeleton Army evo.
    expect(r).toEqual({ downloaded: 63, skipped: 1, failed: 2 });

    const files = readdirSync(dir);
    expect(files).toContain("26000001.png");
    expect(files).toContain("26000000-evo.png");
    expect(files).toContain("26000000-hero.png");
    expect(files).toContain("26000012.png");
    expect(files).not.toContain("26000012-evo.png");
    expect(files).not.toContain("26000001-evo.png");
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);

    expect(readFileSync(join(dir, "26000000.png"), "utf8")).toBe("old knight");
    expect(new Uint8Array(readFileSync(join(dir, "26000001.png")))).toEqual(PNG);

    expect(resolveCardIcon(26000001, "base", "https://official")).toMatch(/^\/cards\/26000001\.png\?v=/);
    expect(resolveCardIcon(26000001, "evo", ARCHERS_EVO)).toBe(ARCHERS_EVO);
  });

  test("network errors count as failures and creates a missing cache dir", async () => {
    const nested = join(dir, "nested", "cards");
    config.CARD_IMAGE_DIR = nested;
    expect(cardImageCacheEmpty()).toBe(true);
    const logged = spyOn(console, "error").mockImplementation(() => {});

    const r = await syncCardImages({
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });

    logged.mockRestore();
    expect(r).toEqual({ downloaded: 0, skipped: 1, failed: 65 });
    expect(existsSync(nested)).toBe(true);
    expect(cardImageCacheEmpty()).toBe(true);
  });

  test("cardImageCacheEmpty turns false once a PNG is cached", async () => {
    await syncCardImages({ fetchImpl: (async () => new Response(PNG)) as unknown as typeof fetch });
    expect(cardImageCacheEmpty()).toBe(false);
  });
});
