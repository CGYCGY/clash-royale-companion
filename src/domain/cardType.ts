export type CardType = "troop" | "building" | "spell";

// The API has no card type field, but its card ids are grouped by type: 26xxxxxx troops, 27xxxxxx buildings,
// 28xxxxxx spells (tower troops are 159xxxxxx and have no type here).
const TYPE_BY_PREFIX: Record<number, CardType> = { 26: "troop", 27: "building", 28: "spell" };

export function cardType(id: number): CardType | null {
  return TYPE_BY_PREFIX[Math.floor(id / 1_000_000)] ?? null;
}
