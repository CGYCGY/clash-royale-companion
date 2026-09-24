export interface ModeKey {
  type: string;
  gameModeName: string;
  eventTag: string | null;
}

const CLAN_WAR_TYPES = new Set([
  "riverRacePvP",
  "riverRaceDuel",
  "riverRaceDuelColosseum",
  "boatBattle",
  "clanWarWarDay",
  "clanWarCollectionDay",
]);

const TWO_VS_TWO_TYPES = new Set(["casual2v2", "clanMate2v2", "friendly2v2"]);

const TYPE_LABELS: Record<string, string> = {
  // The API still calls Ranked "pathOfLegend".
  pathOfLegend: "Ranked",
  friendly: "Friendly",
  clanMate: "Friendly",
  challenge: "Challenge",
  tournament: "Tournament",
  casual1v1: "Casual 1v1",
};

// Prefixes and suffixes Supercell puts on internal mode ids ("RR_Heist_Friendly") that mean nothing to a player.
const NOISE_WORDS = new Set(["RR", "CW", "Friendly", "Event"]);

/** "RR_CaptureTheEgg_Friendly" → "Capture The Egg". Falls back to the input when nothing is left. */
export function humanizeMode(raw: string): string {
  const words = raw
    .split(/[_\s]+/)
    .flatMap((w) => w.replace(/([a-z])([A-Z])/g, "$1 $2").split(" "))
    .filter((w) => w && !NOISE_WORDS.has(w))
    .map((w) => w[0]!.toUpperCase() + w.slice(1));
  return words.length ? words.join(" ") : raw;
}

/**
 * Readable mode name. An /events title wins because it's what the game shows (it covers the
 * `unknown`/`trail` types Royale Shuffle and Princess Gambit report); known types come next; the
 * raw game mode id, humanized, is the last resort.
 */
export function battleModeLabel(b: ModeKey, eventTitles: ReadonlyMap<string, string>): string {
  const title = b.eventTag ? eventTitles.get(b.eventTag) : undefined;
  if (title) return title;
  if (CLAN_WAR_TYPES.has(b.type)) return "Clan War";
  if (b.gameModeName === "TeamVsTeam" || TWO_VS_TWO_TYPES.has(b.type)) return "2v2";
  const byType = TYPE_LABELS[b.type];
  if (byType) return byType;
  if (b.type === "PvP" && b.gameModeName.startsWith("Ladder")) return "Trophy Road";
  return humanizeMode(b.gameModeName || b.type);
}
