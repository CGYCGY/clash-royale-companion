import type { CrApi } from "../cr/client";
import { upsertEvents } from "../repos/events";

/** Stores /events titles used to label battles. Throws on API failure. Returns events stored. */
export async function syncEvents(client: CrApi): Promise<number> {
  const events = await client.getEvents();
  // Undocumented endpoint: guard the shape rather than trust it.
  if (!Array.isArray(events)) throw new Error("Unexpected /events response");
  return upsertEvents(events);
}
