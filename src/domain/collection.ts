import { displayLevel } from "../cr/levels";
import type { Player, PlayerCard } from "../cr/types";
import type { CardRecord } from "../repos/cards";
import { copiesForNextLevel, copiesToMax, goldForNextLevel, goldToMax } from "./upgradeTable";

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
  evolutionLevel: number;
  maxEvolutionLevel: number;
  iconUrl: string | null;
  iconUrlEvo: string | null;
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

function toEntry(card: CardRecord | null, owned: PlayerCard | undefined, kind: "card" | "support"): CollectionEntry {
  const rarity = (card?.rarity ?? owned?.rarity ?? "").toLowerCase();
  const apiMax = card?.maxLevel ?? owned?.maxLevel ?? 0;
  const maxLevel = displayLevel(apiMax, rarity);
  const level = owned ? displayLevel(owned.level, rarity) : null;
  const count = owned?.count ?? 0;
  const upgradable = level !== null && level < maxLevel;
  const countNeeded = upgradable ? copiesForNextLevel(rarity, level) : null;
  const copiesLeft = level === null ? null : copiesToMax(rarity, level, maxLevel);
  return {
    id: card?.id ?? owned!.id,
    name: card?.name ?? owned!.name,
    rarity,
    elixirCost: card ? card.elixirCost : (owned?.elixirCost ?? null),
    owned: !!owned,
    level,
    maxLevel,
    count,
    countNeeded,
    goldNeeded: countNeeded === null ? null : goldForNextLevel(level!),
    goldToMax: level === null ? null : goldToMax(rarity, level, maxLevel),
    copiesToMax: copiesLeft === null ? null : Math.max(0, copiesLeft - count),
    upgradeReady: countNeeded !== null && count >= countNeeded,
    evolutionLevel: owned?.evolutionLevel ?? 0,
    maxEvolutionLevel: card?.maxEvolutionLevel ?? owned?.maxEvolutionLevel ?? 0,
    iconUrl: card?.iconUrl ?? owned?.iconUrls.medium ?? null,
    iconUrlEvo: card?.iconUrlEvo ?? owned?.iconUrls.evolutionMedium ?? null,
    kind,
  };
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
    entries,
    summary: {
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
    },
  };
}
