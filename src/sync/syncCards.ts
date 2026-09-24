import type { CrApi } from "../cr/client";
import { upsertCards } from "../repos/cards";

/** Upserts the card catalog (cards + tower troops). Throws on API failure. Returns cards stored. */
export async function syncCards(client: CrApi): Promise<number> {
  const res = await client.getCards();
  let n = upsertCards(res.items, "card");
  if (res.supportItems?.length) n += upsertCards(res.supportItems, "support");
  return n;
}
