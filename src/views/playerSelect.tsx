import type { Context } from "hono";
import { currentUser } from "../auth/middleware";
import { normalizeTag, tagSlug } from "../cr/tag";
import { notFound } from "../errors";
import { listPlayersForUser, type PlayerRecord } from "../repos/players";
import type { AppEnv } from "../types";

export type ResolvedPlayer = { players: PlayerRecord[]; player: PlayerRecord } | { players: []; player: null };

/** The player picked by `?tag=` (must be the user's, else 404), defaulting to their first. */
export function resolvePlayer(c: Context<AppEnv>): ResolvedPlayer {
  const players = listPlayersForUser(currentUser(c).id);
  const first = players[0];
  if (!first) return { players: [], player: null };
  const raw = c.req.query("tag");
  if (!raw) return { players, player: first };
  const tag = normalizeTag(raw);
  const player = players.find((p) => p.tag === tag);
  if (!player) throw notFound("Player");
  return { players, player };
}

export function PlayerSwitcher({
  players,
  active,
  basePath,
}: {
  players: PlayerRecord[];
  active: PlayerRecord;
  basePath: string;
}) {
  if (players.length < 2) return null;
  return (
    <nav class="player-switcher" aria-label="Player">
      {players.map((p) => (
        <a
          href={`${basePath}?tag=${tagSlug(p.tag)}`}
          class={p.tag === active.tag ? "active" : undefined}
          aria-current={p.tag === active.tag ? "page" : undefined}
        >
          {p.name || p.tag} <span class="muted">{p.tag}</span>
        </a>
      ))}
    </nav>
  );
}
