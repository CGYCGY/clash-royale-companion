import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CardForm, cacheDir, cardImageFile, hasOverride, refreshCardImageIndex } from "../cardImages";
import { listCardOfficialIcons } from "../repos/cardIcons";

export interface SyncCardImagesResult {
  downloaded: number;
  skipped: number;
  failed: number;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const isPng = (b: Uint8Array): boolean => b.length >= 8 && PNG_MAGIC.every((v, i) => b[i] === v);

/**
 * Re-downloads every official card image into CARD_IMAGE_DIR. A failed form keeps whatever file was there,
 * and forms with a committed override are never fetched.
 */
export async function syncCardImages(
  opts: { fetchImpl?: typeof fetch; concurrency?: number } = {},
): Promise<SyncCardImagesResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  // The index decides hasOverride, so it must reflect public/cards/ before we start.
  refreshCardImageIndex();

  const jobs: { file: string; url: string }[] = [];
  let skipped = 0;
  for (const c of listCardOfficialIcons()) {
    const forms: [CardForm, string | null][] = [
      ["base", c.medium],
      ["evo", c.evolutionMedium],
      ["hero", c.heroMedium],
    ];
    for (const [form, url] of forms) {
      if (!url) continue;
      if (hasOverride(c.id, form)) skipped++;
      else jobs.push({ file: cardImageFile(c.id, form), url });
    }
  }

  let downloaded = 0;
  const failures: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      // Same directory as the target so the rename is atomic (a different filesystem would make it a copy).
      const tmp = join(dir, `.${job.file}.${process.pid}.tmp`);
      try {
        const res = await fetchImpl(job.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = new Uint8Array(await res.arrayBuffer());
        if (!isPng(body)) throw new Error("not a PNG");
        writeFileSync(tmp, body);
        renameSync(tmp, join(dir, job.file));
        downloaded++;
      } catch (err) {
        rmSync(tmp, { force: true });
        failures.push(`${job.file} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));

  refreshCardImageIndex();
  if (failures.length) {
    const shown = failures.slice(0, 5).join(", ");
    console.error(
      `[card-images] ${failures.length} downloads failed, kept existing files: ${shown}${failures.length > 5 ? ", ..." : ""}`,
    );
  }
  return { downloaded, skipped, failed: failures.length };
}

export function cardImageCacheEmpty(): boolean {
  try {
    return !readdirSync(cacheDir()).some((n) => n.endsWith(".png"));
  } catch {
    return true;
  }
}
