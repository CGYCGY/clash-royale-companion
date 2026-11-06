import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshCardImageIndex } from "../src/cardImages";
import { config } from "../src/config";
import { BOOST_SCHEDULE } from "../src/domain/boostedCards";

// The image index scans CARD_IMAGE_DIR at import; a dev machine that has run the downloader would
// otherwise turn every official icon URL in the tests into /cards/..., so point it at an empty dir.
config.CARD_IMAGE_DIR = mkdtempSync(join(tmpdir(), "cr-test-cards-"));
refreshCardImageIndex();

// The live boost schedule depends on today's date, so tests start without it and add windows explicitly.
BOOST_SCHEDULE.splice(0);
