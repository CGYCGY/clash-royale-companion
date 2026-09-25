import { displayLevel } from "../cr/levels";
import type { Player, PlayerCard } from "../cr/types";
import type { CardRecord } from "../repos/cards";
import { copiesForNextLevel, copiesToMax, goldForNextLevel, goldToMax, upgradableNow } from "./upgradeTable";

export interface CollectionEntry {
  id: number;
  name: string;
  rarity: string;
  elixirCost: number | null;
  owned: boolean;
  /** In-game display level; null when not owned. */
  level: number | null;
  /** In-game display max level. */
  maxLevel: number;
  /** Copies held toward the next upgrade. */
  count: number;
  /** Copies needed for the next level; null when unowned, maxed, or outside the upgrade table. */
  countNeeded: number | null;
  /** Gold for the next level; null in the same cases as countNeeded. */
  goldNeeded: number | null;
  /** Gold from the current level to maxLevel; 0 when maxed, null when unowned or outside the table. */
  goldToMax: number | null;
  /** Copies still to collect for maxLevel beyond `count` (never below 0); null like goldToMax. */
  copiesToMax: number | null;
  upgradeReady: boolean;
  /** Levels the held copies pay for right now, carrying leftovers from one upgrade to the next. */
  upgradableLevels: number;
  /** Gold for those `upgradableLevels`; 0 when there are none. */
  upgradableGold: number;
  /** Levels between the current level and maxLevel; null when not owned. */
  levelsToMax: number | null;
  /** Bitmasks (1 = Evo, 2 = Hero): what the player owns, and what the card can have. */
  evolutionLevel: number;
  maxEvolutionLevel: number;
  iconUrl: string | null;
  iconUrlEvo: string | null;
  iconUrlHero: string | null;
  kind: "card" | "support";
}

export interface CollectionSummary {
  total: number;
  owned: number;
  missing: number;
  maxed: number;
  upgradeReady: number;
  byRarity: { rarity: string; total: number; owned: number; avgLevel: number | null }[];
}

export interface Collection {
  entries: CollectionEntry[];
  summary: CollectionSummary;
}

export const RARITY_ORDER = ["common", "rare", "epic", "legendary", "champion"];

const rarityRank = (r: string): number => {
  const i = RARITY_ORDER.indexOf(r);
  return i === -1 ? RARITY_ORDER.length : i;
};

type LevelFields = Pick<
  CollectionEntry,
  | "level"
  | "count"
  | "countNeeded"
  | "goldNeeded"
  | "goldToMax"
  | "copiesToMax"
  | "upgradeReady"
  | "upgradableLevels"
  | "upgradableGold"
  | "levelsToMax"
>;

function levelFields(rarity: string, level: number | null, count: number, maxLevel: number): LevelFields {
  const upgradable = level !== null && level < maxLevel;
  const countNeeded = upgradable ? copiesForNextLevel(rarity, level) : null;
  const copiesLeft = level === null ? null : copiesToMax(rarity, level, maxLevel);
  const now = upgradable ? upgradableNow(rarity, level, count, maxLevel) : null;
  return {
    level,
    count,
    countNeeded,
    goldNeeded: countNeeded === null ? null : goldForNextLevel(level!),
    goldToMax: level === null ? null : goldToMax(rarity, level, maxLevel),
    copiesToMax: copiesLeft === null ? null : Math.max(0, copiesLeft - count),
    upgradeReady: countNeeded !== null && count >= countNeeded,
    upgradableLevels: now?.levels ?? 0,
    upgradableGold: now?.gold ?? 0,
    levelsToMax: level === null ? null : Math.max(0, maxLevel - level),
  };
}

function toEntry(card: CardRecord | null, owned: PlayerCard | undefined, kind: "card" | "support"): CollectionEntry {
  const rarity = (card?.rarity ?? owned?.rarity ?? "").toLowerCase();
  const apiMax = card?.maxLevel ?? owned?.maxLevel ?? 0;
  const maxLevel = displayLevel(apiMax, rarity);
  const level = owned ? displayLevel(owned.level, rarity) : null;
  return {
    id: card?.id ?? owned!.id,
    name: card?.name ?? owned!.name,
    rarity,
    elixirCost: card ? card.elixirCost : (owned?.elixirCost ?? null),
    owned: !!owned,
    maxLevel,
    ...levelFields(rarity, level, owned?.count ?? 0, maxLevel),
    evolutionLevel: owned?.evolutionLevel ?? 0,
    maxEvolutionLevel: card?.maxEvolutionLevel ?? owned?.maxEvolutionLevel ?? 0,
    iconUrl: card?.iconUrl ?? owned?.iconUrls.medium ?? null,
    iconUrlEvo: card?.iconUrlEvo ?? owned?.iconUrls.evolutionMedium ?? null,
    iconUrlHero: card?.iconUrlHero ?? owned?.iconUrls.heroMedium ?? null,
    kind,
  };
}

/**
 * The entry as if every upgrade its copies pay for were done: the level jumps by `upgradableLevels`
 * and `count` becomes the copies left over, so nothing is upgrade-ready afterwards.
 */
export function projectAffordable(e: CollectionEntry): CollectionEntry {
  if (e.level === null || e.upgradableLevels === 0) return e;
  const now = upgradableNow(e.rarity, e.level, e.count, e.maxLevel);
  return { ...e, ...levelFields(e.rarity, now.toLevel, now.copiesLeft, e.maxLevel) };
}

/**
 * Joins the catalog with a snapshot's `cards`/`supportCards` (raw API levels) into display-level
 * entries. A null player (no snapshot yet) yields the catalog with nothing owned.
 */
export function buildCollection(
  player: Pick<Player, "cards" | "supportCards"> | null,
  catalog: CardRecord[],
): Collection {
  const ownedById = new Map<number, { card: PlayerCard; kind: "card" | "support" }>();
  for (const c of player?.cards ?? []) ownedById.set(c.id, { card: c, kind: "card" });
  for (const c of player?.supportCards ?? []) ownedById.set(c.id, { card: c, kind: "support" });

  const entries: CollectionEntry[] = catalog.map((c) => toEntry(c, ownedById.get(c.id)?.card, c.kind));
  const catalogIds = new Set(catalog.map((c) => c.id));
  // The catalog syncs daily, so a brand-new card can show up in a player's collection first.
  for (const [id, { card, kind }] of ownedById) {
    if (!catalogIds.has(id)) entries.push(toEntry(null, card, kind));
  }

  entries.sort(
    (a, b) =>
      Number(a.kind === "support") - Number(b.kind === "support") ||
      Number(b.owned) - Number(a.owned) ||
      rarityRank(a.rarity) - rarityRank(b.rarity) ||
      a.name.localeCompare(b.name),
  );

  return { entries, summary: summarizeCollection(entries) };
}

export function summarizeCollection(entries: CollectionEntry[]): CollectionSummary {
  const byRarity = new Map<string, { total: number; owned: number; levelSum: number }>();
  let owned = 0;
  let maxed = 0;
  let upgradeReady = 0;
  for (const e of entries) {
    if (e.kind !== "card") continue;
    const r = byRarity.get(e.rarity) ?? { total: 0, owned: 0, levelSum: 0 };
    r.total++;
    if (e.owned) {
      owned++;
      r.owned++;
      r.levelSum += e.level ?? 0;
      if (e.level !== null && e.level >= e.maxLevel) maxed++;
      if (e.upgradeReady) upgradeReady++;
    }
    byRarity.set(e.rarity, r);
  }
  const total = entries.filter((e) => e.kind === "card").length;

  return {
    total,
    owned,
    missing: total - owned,
    maxed,
    upgradeReady,
    byRarity: [...byRarity.entries()]
      .sort(([a], [b]) => rarityRank(a) - rarityRank(b))
      .map(([rarity, r]) => ({
        rarity,
        total: r.total,
        owned: r.owned,
        avgLevel: r.owned ? Math.round((r.levelSum / r.owned) * 100) / 100 : null,
      })),
  };
}

export const COLLECTION_SORTS = ["rarity", "name", "level", "elixir", "progress", "upgradable"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];
export type SortOrder = "asc" | "desc";

/** The order a sort starts in when none was picked: "best first" for the level-ish sorts. */
export const DEFAULT_ORDER: Record<CollectionSort, SortOrder> = {
  rarity: "asc",
  name: "asc",
  elixir: "asc",
  level: "desc",
  progress: "desc",
  upgradable: "desc",
};

const progressOf = (e: CollectionEntry): number | null => (e.countNeeded ? e.count / e.countNeeded : null);

// null means "no value" (not owned, maxed, variable elixir) and always sorts last in either order.
const SORT_KEYS: Record<CollectionSort, (e: CollectionEntry) => (number | string | null)[]> = {
  rarity: (e) => [rarityRank(e.rarity)],
  name: (e) => [e.name],
  level: (e) => [e.level],
  elixir: (e) => [e.elixirCost],
  progress: (e) => [progressOf(e)],
  upgradable: (e) => [e.countNeeded === null ? null : e.upgradableLevels, progressOf(e)],
};

/** A sorted copy; ties fall back to name A→Z whatever the order. */
export function sortCollection(entries: CollectionEntry[], sort: CollectionSort, order: SortOrder): CollectionEntry[] {
  const dir = order === "asc" ? 1 : -1;
  const keysOf = SORT_KEYS[sort];
  return entries
    .map((e) => ({ e, keys: keysOf(e) }))
    .sort((a, b) => {
      for (let i = 0; i < a.keys.length; i++) {
        const x = a.keys[i] ?? null;
        const y = b.keys[i] ?? null;
        if (x === y) continue;
        if (x === null) return 1;
        if (y === null) return -1;
        const cmp = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
        if (cmp !== 0) return cmp * dir;
      }
      return a.e.name.localeCompare(b.e.name);
    })
    .map(({ e }) => e);
}
