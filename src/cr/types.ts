export type Rarity = "common" | "rare" | "epic" | "legendary" | "champion";

export interface IconUrls {
  medium?: string;
  evolutionMedium?: string;
  heroMedium?: string;
}

/**
 * A card as it appears in a player's collection or current deck. `level` is API-relative, see src/cr/levels.ts.
 * `evolutionLevel`/`maxEvolutionLevel` are a bitmask (1 = Evolution, 2 = Hero), decoded in src/domain/evolution.ts.
 */
export interface PlayerCard {
  id: number;
  name: string;
  level: number;
  maxLevel: number;
  starLevel?: number;
  evolutionLevel?: number;
  maxEvolutionLevel?: number;
  rarity?: Rarity;
  count?: number;
  elixirCost?: number;
  iconUrls: IconUrls;
}

export interface ClanRef {
  tag: string;
  name: string;
  badgeId: number;
}

export interface Arena {
  id: number;
  name: string;
  /** Internal id such as "Arena_L18"; absent from snapshots taken before mid-2026. */
  rawName?: string;
}

/** One entry of Player.progress, keyed e.g. "seasonal-trophy-road-202609" or "AutoChess_2026_Season_11". */
export interface ProgressEntry {
  arena: Arena;
  trophies: number;
  bestTrophies: number;
}

export interface PathOfLegendResult {
  leagueNumber: number;
  trophies: number;
  rank: number | null;
}

export interface Badge {
  name: string;
  level?: number;
  maxLevel?: number;
  progress?: number;
  target?: number;
  iconUrls?: { large?: string };
}

export interface Achievement {
  name: string;
  stars: number;
  value: number;
  target: number;
  info: string;
  completionInfo: string | null;
}

export interface LeagueSeason {
  id?: string;
  trophies: number;
  bestTrophies?: number;
}

export interface Player {
  tag: string;
  name: string;
  /** Frozen since XP was removed on 2026-05-26; use kingTowerLevel instead. */
  expLevel: number;
  expPoints?: number;
  totalExpPoints?: number;
  trophies: number;
  bestTrophies: number;
  wins: number;
  losses: number;
  battleCount: number;
  threeCrownWins: number;
  challengeCardsWon?: number;
  challengeMaxWins?: number;
  tournamentCardsWon?: number;
  tournamentBattleCount?: number;
  role?: string;
  donations?: number;
  donationsReceived?: number;
  totalDonations?: number;
  warDayWins?: number;
  clanCardsCollected?: number;
  starPoints?: number;
  clan?: ClanRef;
  arena?: Arena;
  leagueStatistics?: {
    currentSeason?: LeagueSeason;
    previousSeason?: LeagueSeason;
    bestSeason?: LeagueSeason;
  };
  badges?: Badge[];
  achievements?: Achievement[];
  cards: PlayerCard[];
  supportCards?: PlayerCard[];
  currentDeck: PlayerCard[];
  currentDeckSupportCards?: PlayerCard[];
  currentFavouriteCard?: Omit<PlayerCard, "level" | "count">;
  currentPathOfLegendSeasonResult?: PathOfLegendResult;
  lastPathOfLegendSeasonResult?: PathOfLegendResult;
  bestPathOfLegendSeasonResult?: PathOfLegendResult;
  // The fields below arrived with the 2026-05-26 Collection Levels update; older snapshots lack them.
  kingTowerLevel?: number;
  /** Sum of all card and tower troop display levels plus 5 per Evolution or Hero owned. */
  collectionLevel?: number;
  /** Signed: positive is a win streak, negative a loss streak. */
  currentWinLoseStreak?: number;
  /** Best Trophy Road score before the 2026 rework; null for players who never had one. */
  legacyTrophyRoadHighScore?: number | null;
  progress?: Record<string, ProgressEntry>;
}

export interface BattleCard {
  id: number;
  name: string;
  level: number;
  maxLevel?: number;
  starLevel?: number;
  evolutionLevel?: number;
  maxEvolutionLevel?: number;
  rarity?: Rarity;
  elixirCost?: number;
  iconUrls: IconUrls;
}

export interface BattleParticipant {
  tag: string;
  name: string;
  crowns: number;
  kingTowerHitPoints?: number;
  princessTowersHitPoints?: number[] | null;
  startingTrophies?: number;
  trophyChange?: number;
  clan?: ClanRef;
  cards: BattleCard[];
  supportCards?: BattleCard[];
  globalRank?: number | null;
  elixirLeaked?: number;
}

export interface BattleLogEntry {
  type: string;
  /** Compact form "20240101T120000.000Z"; convert with parseBattleTime. */
  battleTime: string;
  isLadderTournament?: boolean;
  isHostedMatch?: boolean;
  arena?: Arena;
  gameMode: { id: number; name: string };
  deckSelection?: string;
  leagueNumber?: number;
  challengeId?: number;
  challengeTitle?: string;
  challengeWinCountBefore?: number;
  tournamentTag?: string;
  /** Joins to GET /events for a readable title; null for ladder, ranked and clan war battles. */
  eventTag?: string | null;
  /** Boat battles report 0-0 crowns; the outcome is only here. */
  boatBattleWon?: boolean;
  boatBattleSide?: string;
  team: BattleParticipant[];
  opponent: BattleParticipant[];
}

/** From the undocumented GET /events; lists only currently running events. */
export interface GameEvent {
  eventTag: string;
  title: string;
  description: string | null;
}

export interface CatalogCard {
  id: number;
  name: string;
  maxLevel: number;
  maxEvolutionLevel?: number;
  elixirCost?: number;
  rarity: Rarity;
  iconUrls: IconUrls;
}

export interface CardsResponse {
  items: CatalogCard[];
  supportItems?: CatalogCard[];
}

const BATTLE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?Z$/;

export function parseBattleTime(s: string): string {
  const m = BATTLE_TIME_RE.exec(s);
  if (!m) throw new Error(`Unrecognized battleTime format: ${s}`);
  const [, y, mo, d, h, mi, sec, ms = "0"] = m;
  const date = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +sec!, +ms.padEnd(3, "0")));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid battleTime: ${s}`);
  return date.toISOString();
}
