import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../../auth/middleware";
import { tagSlug } from "../../cr/tag";
import { buildCollection, type CollectionEntry, RARITY_ORDER } from "../../domain/collection";
import { parseQuery } from "../../http/validate";
import { listCards } from "../../repos/cards";
import { getLatestSnapshot } from "../../repos/players";
import type { AppEnv } from "../../types";
import { CardIcon, EmptyState, StatTile } from "../../views/components";
import { formatRelative } from "../../views/format";
import { PlayerSwitcher, resolvePlayer } from "../../views/playerSelect";
import { renderPage } from "../../views/render";

const filterSchema = z.object({
  q: z.string().max(100).default("").catch(""),
  ready: z.string().optional().catch(undefined),
  missing: z.string().optional().catch(undefined),
});

const formatNumber = (n: number): string => n.toLocaleString("en-US");

const view = (e: CollectionEntry) => ({
  name: e.name,
  iconUrl: e.iconUrl,
  iconUrlEvo: e.iconUrlEvo,
  level: e.level ?? undefined,
  evolutionLevel: e.evolutionLevel,
  elixirCost: e.elixirCost,
});

function Progress({ e }: { e: CollectionEntry }) {
  if (!e.owned) return <div class="progress-label muted">missing</div>;
  if (e.level !== null && e.level >= e.maxLevel) return <div class="progress-label pos">MAX</div>;
  if (e.countNeeded === null) return <div class="progress-label muted">{e.count} cards</div>;
  const pct = Math.min(100, Math.round((e.count / e.countNeeded) * 100));
  const toMax =
    e.copiesToMax !== null && e.goldToMax !== null
      ? ` · to max: ${formatNumber(e.copiesToMax)} more copies, ${formatNumber(e.goldToMax)} gold`
      : "";
  return (
    <>
      <div class="progress" title={`${e.count} / ${e.countNeeded} copies${toMax}`}>
        <div class={`progress-bar${e.upgradeReady ? " ready" : ""}`} style={`width:${pct}%`} />
        <span class="progress-text">
          {e.count}/{e.countNeeded}
        </span>
      </div>
      {e.goldNeeded !== null && <div class="gold">{formatNumber(e.goldNeeded)} gold</div>}
    </>
  );
}

function CollectionCard({ e }: { e: CollectionEntry }) {
  return (
    <div class={`coll-card${e.owned ? "" : " missing"}${e.upgradeReady ? " ready" : ""}`}>
      <CardIcon card={view(e)} size="md" />
      <div class="coll-name" title={e.name}>
        {e.name}
      </div>
      <Progress e={e} />
      {e.maxEvolutionLevel > 0 && (
        <div class={`evo-badge${e.evolutionLevel > 0 ? " unlocked" : ""}`}>
          Evo {e.evolutionLevel}/{e.maxEvolutionLevel}
        </div>
      )}
    </div>
  );
}

export const collectionPages = new Hono<AppEnv>().use("/collection/*", requireUser).get("/collection", (c) => {
  const { players, player } = resolvePlayer(c);
  if (!player) {
    return renderPage(
      c,
      { title: "Collection", active: "collection" },
      <EmptyState title="No players linked yet">
        <a class="btn" href="/settings">
          Link a player
        </a>
      </EmptyState>,
    );
  }
  const snapshot = getLatestSnapshot(player.tag);
  if (!snapshot) {
    return renderPage(
      c,
      { title: "Collection", active: "collection" },
      <div class="stack">
        <PlayerSwitcher players={players} active={player} basePath="/collection" />
        <EmptyState title="No collection data yet">
          <p class="muted">This player hasn't synced successfully.</p>
          {player.lastSyncError && <p class="error-text">Last error: {player.lastSyncError}</p>}
        </EmptyState>
      </div>,
    );
  }
  const f = parseQuery(c, filterSchema);
  const { entries, summary } = buildCollection(snapshot.player, listCards());
  const q = f.q.trim().toLowerCase();
  const onlyReady = f.ready === "1";
  const onlyMissing = f.missing === "1";
  const shown = entries.filter(
    (e) =>
      (!q || e.name.toLowerCase().includes(q)) && (!onlyReady || e.upgradeReady) && (!onlyMissing || !e.owned),
  );
  const ready = entries.filter((e) => e.upgradeReady);
  const cards = shown.filter((e) => e.kind === "card");
  const extraRarities = [...new Set(cards.map((e) => e.rarity))].filter((r) => !RARITY_ORDER.includes(r));
  const sections = [
    ...[...RARITY_ORDER, ...extraRarities].map((r) => ({ title: r, items: cards.filter((e) => e.rarity === r) })),
    { title: "Tower troops", items: shown.filter((e) => e.kind === "support") },
  ].filter((s) => s.items.length > 0);
  const filtered = Boolean(q || onlyReady || onlyMissing);

  return renderPage(
    c,
    { title: "Collection", active: "collection" },
    <div class="stack">
      <PlayerSwitcher players={players} active={player} basePath="/collection" />
      <div class="row">
        <h1>Collection</h1>
        <div class="spacer" />
        <span class="muted small">
          {snapshot.player.name} · snapshot {formatRelative(snapshot.lastSeenAt)}
        </span>
      </div>
      <div class="stats">
        <StatTile label="Owned" value={`${summary.owned}/${summary.total}`} hint={`${summary.missing} missing`} />
        <StatTile label="Maxed" value={summary.maxed} />
        <StatTile label="Upgrade ready" value={summary.upgradeReady} />
        {summary.byRarity.map((r) => (
          <StatTile
            label={r.rarity}
            value={`${r.owned}/${r.total}`}
            hint={r.avgLevel === null ? undefined : `avg level ${r.avgLevel.toFixed(1)}`}
          />
        ))}
      </div>

      {ready.length > 0 && !filtered && (
        <section class="card">
          <h2>Upgrade ready</h2>
          <div class="card-strip">
            {ready.map((e) => (
              <CardIcon card={view(e)} size="md" />
            ))}
          </div>
        </section>
      )}

      <form method="get" action="/collection" class="filters">
        <input type="hidden" name="tag" value={tagSlug(player.tag)} />
        <div class="field">
          <label for="q">Search</label>
          <input type="search" id="q" name="q" value={f.q} placeholder="Card name" />
        </div>
        <label class="check">
          <input type="checkbox" name="ready" value="1" checked={onlyReady} /> Upgrade ready
        </label>
        <label class="check">
          <input type="checkbox" name="missing" value="1" checked={onlyMissing} /> Missing
        </label>
        <div class="filter-actions">
          <button type="submit">Filter</button>
          {filtered && <a href={`/collection?tag=${tagSlug(player.tag)}`}>Clear</a>}
        </div>
      </form>

      {sections.length === 0 && <p class="muted">No cards match these filters.</p>}
      {sections.map((s) => (
        <section>
          <h2 class="rarity-title">
            {s.title} <span class="muted small">{s.items.length}</span>
          </h2>
          <div class="coll-grid">
            {s.items.map((e) => (
              <CollectionCard e={e} />
            ))}
          </div>
        </section>
      ))}
    </div>,
  );
});
