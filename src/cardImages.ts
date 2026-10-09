import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

/**
 * Card art comes from three places, first match wins:
 *   1. public/cards/            hand-picked overrides committed to the repo (Supercell's API ships the
 *                               base art for some evolutions, e.g. Skeleton Army), never refreshed
 *   2. CARD_IMAGE_DIR           a local copy of the official art, refilled by syncCardImages
 *   3. iconUrls from the API    the live Supercell CDN, used until the cache has the file
 * Files are named by card id and form so renames in the API can't orphan them: 26000012.png,
 * 26000012-evo.png, 26000012-hero.png.
 */
export type CardForm = "base" | "evo" | "hero";

export const OVERRIDE_DIR = join(import.meta.dir, "..", "public", "cards");
export const cacheDir = (): string => config.CARD_IMAGE_DIR;

export const cardImageFile = (id: number, form: CardForm): string => `${id}${form === "base" ? "" : `-${form}`}.png`;

export interface IndexedImage {
  source: "override" | "cache";
  /** Absolute path to serve. */
  path: string;
  /** Cache-busting version, from size and mtime so a refreshed file gets a new URL without hashing 50 MB at boot. */
  version: string;
}

let index = new Map<string, IndexedImage>();

function scan(dir: string, source: IndexedImage["source"]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return; // a missing directory just contributes nothing
  }
  for (const name of names) {
    if (!/^\d+(-evo|-hero)?\.png$/.test(name) || index.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    index.set(name, { source, path, version: `${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}` });
  }
}

/** Rescans both directories. Call at startup and after every cache refresh. */
export function refreshCardImageIndex(): void {
  index = new Map<string, IndexedImage>();
  scan(OVERRIDE_DIR, "override");
  scan(cacheDir(), "cache");
}

export const indexedImage = (file: string): IndexedImage | undefined => index.get(file);

export const hasOverride = (id: number, form: CardForm): boolean =>
  index.get(cardImageFile(id, form))?.source === "override";

/** Local URL when a file exists, otherwise the official URL (or null when the API has none for that form). */
export function resolveCardIcon(id: number, form: CardForm, officialUrl: string | null): string | null {
  const file = cardImageFile(id, form);
  const hit = index.get(file);
  return hit ? `/cards/${file}?v=${hit.version}` : officialUrl;
}

refreshCardImageIndex();
