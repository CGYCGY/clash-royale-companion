import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireUser } from "../../auth/middleware";
import { normalizeTag, tagSlug } from "../../cr/tag";
import { afterSwitchPath, rememberPlayer, resolvePlayer } from "../../http/currentPlayer";
import { setFlash } from "../../http/flash";
import { parseForm } from "../../http/validate";
import { averageElixir, type BattleStats, getBattleStats, listBattles } from "../../repos/battles";
import { cardsMap } from "../../repos/cards";
import { assertPlayerOwnedBy, getLatestSnapshot, type PlayerRecord, type Snapshot } from "../../repos/players";
import { manualSync } from "../../sync";
import type { AppEnv } from "../../types";
import { BattleTable } from "../../views/battleTable";
import { formatElixir, playerCardView } from "../../views/cardViews";
import { CardIcon, DeckGrid, EmptyState, StatTile } from "../../views/components";
import { formatDateTime, formatPercent, formatRelative, formatSigned } from "../../views/format";
import { renderPage } from "../../views/render";
import { safeNext, syncCooldownRemaining, text } from "./shared";

function PlayerHeader({ player, snapshot }: { player: PlayerRecord; snapshot: Snapshot }) {
  const p = snapshot.player;
  const pol = p.currentPathOfLegendSeasonResult;
  return (
    <section class="card">
      <div class="row">
        <div>
          <h1 class="player-name">{p.name}</h1>
          <div class="muted">
            {player.tag} · King level {p.expLevel}
          </div>
        </div>
        <div class="spacer" />
        <div class="muted small">Snapshot {formatRelative(snapshot.lastSeenAt)}</div>
      </div>
      <dl class="facts">
        <div>
          <dt>Trophies</dt>
          <dd>
            {p.trophies} <span class="muted">/ best {p.bestTrophies}</span>
          </dd>
        </div>
        <div>
          <dt>Arena</dt>
          <dd>{p.arena?.name ?? "–"}</dd>
        </div>
        <div>
          <dt>Clan</dt>
          <dd>{p.clan ? p.clan.name : <span class="muted">none</span>}</dd>
        </div>
        <div>
          <dt>Path of Legend</dt>
          <dd>
            {pol ? (
              <>
                League {pol.leagueNumber} · {pol.trophies} trophies
                {pol.rank !== null && pol.rank !== undefined && <> · rank {pol.rank}</>}
              </>
            ) : (
              <span class="muted">–</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function WindowTiles({ label, stats }: { label: string; stats: BattleStats }) {
  return (
    <>
      <StatTile
        label={`${label} win rate`}
        value={stats.total ? formatPercent(stats.winRate) : "–"}
        hint={`${stats.wins}W ${stats.losses}L ${stats.draws}D`}
      />
      <StatTile label={`${label} games`} value={stats.total} />
      <StatTile label={`${label} trophies`} value={formatSigned(stats.netTrophies)} hint="ladder net" />
    </>
  );
}

function CurrentDeck({ snapshot }: { snapshot: Snapshot }) {
  const catalog = cardsMap();
  const deck = snapshot.player.currentDeck ?? [];
  const tower = snapshot.player.currentDeckSupportCards?.[0];
  const avg = averageElixir(
    deck.map((c) => c.name),
    catalog,
  );
  return (
    <section class="card">
      <h2>Current deck</h2>
      {deck.length ? (
        <DeckGrid cards={deck.map((c) => playerCardView(c, catalog))} size="md" />
      ) : (
        <p class="muted">No deck in the latest snapshot.</p>
      )}
      <div class="row deck-meta">
        <span>
          Avg elixir <strong>{formatElixir(avg)}</strong>
        </span>
        {tower && (
          <span class="row tower">
            <CardIcon card={playerCardView(tower, catalog)} size="sm" />
            <span>
              Tower troop <strong>{tower.name}</strong>
            </span>
          </span>
        )}
      </div>
    </section>
  );
}

function Chests({ snapshot }: { snapshot: Snapshot }) {
  const items = snapshot.chests?.items ?? [];
  return (
    <section class="card">
      <h2>Upcoming chests</h2>
      {items.length ? (
        <ol class="chest-strip">
          {items.map((ch) => (
            <li>
              <span class="chest-index">{ch.index === 0 ? "Next" : `+${ch.index}`}</span>
              <span>{ch.name}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p class="muted">Not available.</p>
      )}
    </section>
  );
}

function SyncCard({ player }: { player: PlayerRecord }) {
  const wait = syncCooldownRemaining(player);
  return (
    <section class="card">
      <h2>Sync</h2>
      <p>
        Last synced:{" "}
        {player.lastSyncedAt ? (
          <span title={formatDateTime(player.lastSyncedAt)}>{formatRelative(player.lastSyncedAt)}</span>
        ) : (
          <span class="muted">never</span>
        )}
      </p>
      {player.lastSyncError && <p class="error-text">Last error: {player.lastSyncError}</p>}
      <form method="post" action={`/players/${tagSlug(player.tag)}/sync`}>
        <button
          type="submit"
          disabled={wait > 0}
          data-retry-after={wait > 0 ? String(wait) : undefined}
          data-ready-label="Sync now"
        >
          {wait > 0 ? `Try again in ${wait}s` : "Sync now"}
        </button>
      </form>
    </section>
  );
}

export const dashboardPages = new Hono<AppEnv>()
  .use("/", requireUser)
  .use("/players/*", requireUser)
  .get("/", (c) => {
    const { current: player } = resolvePlayer(c);
    if (!player) {
      return renderPage(
        c,
        { title: "Dashboard", active: "dashboard" },
        <EmptyState title="No players linked yet">
          <p class="muted">Link your Clash Royale player tag to start syncing battles.</p>
          <a class="btn" href="/settings">
            Link a player
          </a>
        </EmptyState>,
      );
    }
    const snapshot = getLatestSnapshot(player.tag);
    const catalog = cardsMap();
    const battles = listBattles(player.tag, { limit: 10 });
    return renderPage(
      c,
      { title: "Dashboard", active: "dashboard" },
      <div class="stack">
        {snapshot ? (
          <>
            <PlayerHeader player={player} snapshot={snapshot} />
            <div class="stats">
              <WindowTiles label="7d" stats={getBattleStats(player.tag, { sinceDays: 7 })} />
              <WindowTiles label="30d" stats={getBattleStats(player.tag, { sinceDays: 30 })} />
            </div>
            <div class="grid grid-2">
              <CurrentDeck snapshot={snapshot} />
              <Chests snapshot={snapshot} />
            </div>
          </>
        ) : (
          <section class="card notice">
            <h1>{player.name || player.tag}</h1>
            <p>No data yet: this player hasn't synced successfully.</p>
            {player.lastSyncError && <p class="error-text">Last error: {player.lastSyncError}</p>}
          </section>
        )}
        <section>
          <div class="row section-head">
            <h2>Recent battles</h2>
            <div class="spacer" />
            <a class="btn btn-secondary btn-small" href="/battles">
              All battles
            </a>
          </div>
          <BattleTable battles={battles} catalog={catalog} empty="No battles stored yet." />
        </section>
        <SyncCard player={player} />
      </div>,
    );
  })
  .post("/players/:tag/sync", async (c) => {
    const tag = normalizeTag(c.req.param("tag"));
    assertPlayerOwnedBy(tag, currentUser(c).id);
    const r = await manualSync(tag);
    if (r.ok) {
      setFlash(c, "success", `Synced, ${r.battlesAdded} new battle${r.battlesAdded === 1 ? "" : "s"}.`);
    } else if ("retryAfterSeconds" in r) {
      setFlash(c, "info", `Synced recently. Try again in ${r.retryAfterSeconds}s.`);
    } else {
      setFlash(c, "error", `Sync failed: ${r.error}`);
    }
    rememberPlayer(c, tag);
    return c.redirect("/");
  })
  .post("/players/current", async (c) => {
    const form = await parseForm(c, z.object({ tag: text, next: text }));
    const player = assertPlayerOwnedBy(normalizeTag(form.tag), currentUser(c).id);
    rememberPlayer(c, player.tag);
    return c.redirect(afterSwitchPath(safeNext(form.next)));
  });
