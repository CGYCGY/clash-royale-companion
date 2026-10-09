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

// The game splits a River Race into Battle, Duel and Boat Battle; Battle can also run a rotating
// special mode (Touchdown, Ramp Up Elixir, ...), which only the game mode id reveals.
const WAR_VARIANT_BY_TYPE: Record<string, string> = {
  riverRaceDuel: "Duel",
  riverRaceDuelColosseum: "Colosseum Duel",
  boatBattle: "Boat Battle",
};
const PLAIN_WAR_MODES = new Set(["CW_Battle_1v1"]);
const WAR_MODE_NOISE = new Set(["ClanWar", "Ladder"]);

function warVariant(b: ModeKey): string {
  const byType = WAR_VARIANT_BY_TYPE[b.type];
  if (byType) return byType;
  if (b.type !== "riverRacePvP" || !b.gameModeName || PLAIN_WAR_MODES.has(b.gameModeName)) return "Battle";
  const special = b.gameModeName
    .split("_")
    .filter((w) => !WAR_MODE_NOISE.has(w))
    .join("_");
  return special ? humanizeMode(special) : "Battle";
}

export interface BattleMode {
  /** Most specific readable name, e.g. "Clan War · Touchdown". One stats row per label. */
  label: string;
  /**
   * Broad groups the battle belongs to, broadest first, e.g. ["Clan War", "Touchdown"]. A filter on
   * any tag selects the battle.
   */
  tags: string[];
}

const single = (label: string): BattleMode => ({ label, tags: [label] });

/**
 * Readable mode. An /events title wins because it's what the game shows (it covers the
 * `unknown`/`trail` types Royale Shuffle and Princess Gambit report); known types come next; the
 * raw game mode id, humanized, is the last resort.
 */
export function battleMode(b: ModeKey, eventTitles: ReadonlyMap<string, string>): BattleMode {
  const title = b.eventTag ? eventTitles.get(b.eventTag) : undefined;
  if (title) return single(title);
  if (CLAN_WAR_TYPES.has(b.type)) {
    const variant = warVariant(b);
    return { label: `Clan War · ${variant}`, tags: ["Clan War", variant] };
  }
  if (b.gameModeName === "TeamVsTeam" || TWO_VS_TWO_TYPES.has(b.type)) return single("2v2");
  const byType = TYPE_LABELS[b.type];
  if (byType) return single(byType);
  if (b.type === "PvP" && b.gameModeName.startsWith("Ladder")) return single("Trophy Road");
  return single(humanizeMode(b.gameModeName || b.type));
}

export const battleModeLabel = (b: ModeKey, eventTitles: ReadonlyMap<string, string>): string =>
  battleMode(b, eventTitles).label;

/** Whether a mode filter value (a label or a tag) selects a battle with this mode. */
export const modeMatches = (m: BattleMode, filter: string): boolean => m.label === filter || m.tags.includes(filter);
