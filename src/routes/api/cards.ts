import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../../auth/middleware";
import { type CardType, cardType } from "../../domain/cardType";
import { parseQuery } from "../../http/validate";
import { listCards } from "../../repos/cards";
import type { AppEnv } from "../../types";

const commaList = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((s) => s.split(",").map((v) => v.trim().toLowerCase()))
    .pipe(z.array(z.enum(values)))
    .optional();

/** `kind`, plus comma-separated `type` and `rarity` lists. Tower troops have no type, so any `type` drops them. */
export const cardFilterQuery = z.object({
  kind: z.enum(["card", "support"]).optional(),
  type: commaList(["troop", "building", "spell"]),
  rarity: commaList(["common", "rare", "epic", "legendary", "champion"]),
});
export type CardFilter = z.infer<typeof cardFilterQuery>;

export function matchesCardFilter(card: { id: number; kind: string; rarity: string }, f: CardFilter): boolean {
  const type = cardType(card.id);
  return (
    (!f.kind || card.kind === f.kind) &&
    (!f.type || (type !== null && f.type.includes(type))) &&
    (!f.rarity || (f.rarity as string[]).includes(card.rarity.toLowerCase()))
  );
}

export const withType = <C extends { id: number }>(card: C): C & { type: CardType | null } => ({
  ...card,
  type: cardType(card.id),
});

export const cardRoutes = new Hono<AppEnv>().get("/cards", requireUser, (c) => {
  const filter = parseQuery(c, cardFilterQuery);
  return c.json({ cards: listCards({ kind: filter.kind }).filter((card) => matchesCardFilter(card, filter)).map(withType) });
});
