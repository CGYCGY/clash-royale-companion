import { CrApiError, type CrApi, getCrClient } from "../cr/client";
import { normalizeTag } from "../cr/tag";
import { AppError } from "../errors";
import { addPlayer, assertTagAvailable, getPlayer, type PlayerRecord } from "../repos/players";
import { syncPlayer } from "./syncPlayer";

/**
 * The "add a player" flow: normalize the tag, confirm it exists upstream, store it for the user,
 * and run a first sync. Throws AppError: invalid_tag | not_found | conflict | upstream_error.
 */
export async function trackPlayer(
  userId: number,
  rawTag: string,
  client: CrApi = getCrClient(),
): Promise<{ player: PlayerRecord; battlesAdded: number; syncError?: string }> {
  const tag = normalizeTag(rawTag);
  assertTagAvailable(tag, userId);
  let name: string;
  try {
    name = (await client.getPlayer(tag)).name;
  } catch (err) {
    if (err instanceof CrApiError && err.status === 404) {
      throw new AppError("not_found", `No Clash Royale player with tag ${tag}`, 404);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError("upstream_error", msg, 502);
  }
  addPlayer(userId, tag, name);
  const r = await syncPlayer(tag, client);
  return { player: getPlayer(tag)!, battlesAdded: r.battlesAdded, syncError: r.error };
}
