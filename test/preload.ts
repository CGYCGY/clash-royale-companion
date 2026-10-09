import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshCardImageIndex } from "../src/cardImages";
import { config } from "../src/config";

// The image index scans CARD_IMAGE_DIR at import; a dev machine that has run the downloader would
// otherwise turn every official icon URL in the tests into /cards/..., so point it at an empty dir.
config.CARD_IMAGE_DIR = mkdtempSync(join(tmpdir(), "cr-test-cards-"));
refreshCardImageIndex();
