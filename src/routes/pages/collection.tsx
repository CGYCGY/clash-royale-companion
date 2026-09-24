import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../../auth/middleware";
import {
  buildCollection,
  COLLECTION_SORTS,
  type CollectionEntry,
  type CollectionSort,
  DEFAULT_ORDER,
  RARITY_ORDER,
  sortCollection,
} from "../../domain/collection";
import { cardForms } from "../../domain/evolution";
import { resolvePlayer } from "../../http/currentPlayer";
import { parseQuery } from "../../http/validate";
import { listCards } from "../../repos/cards";
import { getLatestSnapshot } from "../../repos/players";
import type { AppEnv } from "../../types";
import { CardIcon, EmptyState, StatTile } from "../../views/components";
import { formatRelative } from "../../views/format";
import { SortAscIcon, SortDescIcon } from "../../views/icons";
import { renderPage } from "../../views/render";

const SORT_LABELS: Record<CollectionSort, string> = {
  rarity: "Rarity",
  name: "Name",
  level: "Level",
  elixir: "Elixir",
  progress: "Upgrade Progress",
  upgradable: "Levels Upgradable Now",
};

// Lenient like the battles filters: a stale or hand-edited value falls back to its default.
const filterSchema = z.object({
  q: z.string().max(100).default("").catch(""),
  ready: z.string().optional().catch(undefined),
  missing: z.string().optional().catch(undefined),
  sort: z.enum(COLLECTION_SORTS).default("rarity").catch("rarity"),
  order: z.enum(["asc", "desc"]).optional().catch(undefined),
});
type Filters = z.infer<typeof filterSchema>;

function collectionHref(f: Filters, overrides: Partial<Filters> = {}): string {
  const merged = { ...f, ...overrides };
  const q = new URLSearchParams();
  if (merged.q) q.set("q", merged.q);
  if (merged.ready === "1") q.set("ready", "1");
  if (merged.missing === "1") q.set("missing", "1");
  if (merged.sort !== "rarity") q.set("sort", merged.sort);
  if (merged.order) q.set("order", merged.order);
  const qs = q.toString();
  return qs ? `/collection?${qs}` : "/collection";
}

const formatNumber = (n: number): string => n.toLocaleString("en-US");

const view = (e: CollectionEntry) => ({
  name: e.name,
  iconUrl: e.iconUrl,
  iconUrlEvo: e.iconUrlEvo,
  iconUrlHero: e.iconUrlHero,
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
      {e.upgradableLevels > 0 ? (
        <>
          <div class="upgrade-now pos">
            +{e.upgradableLevels} level{e.upgradableLevels === 1 ? "" : "s"}
          </div>
          <div class="gold">{formatNumber(e.upgradableGold)} gold</div>
        </>
      ) : (
        e.goldNeeded !== null && <div class="gold">{formatNumber(e.goldNeeded)} gold</div>
      )}
    </>
  );
}

/** One pill per form the card can have, highlighted when owned. */
function FormBadges({ e }: { e: CollectionEntry }) {
  const can = cardForms(e.maxEvolutionLevel);
  const has = cardForms(e.evolutionLevel);
  if (!can.evo && !can.hero) return null;
  const pill = (kind: "evo" | "hero", label: string) => (
    <span
      class={`form-badge form-${kind}${has[kind] ? " unlocked" : ""}`}
      title={`${label} ${has[kind] ? "owned" : "not owned"}`}
    >
      {label}
    </span>
  );
  return (
    <div class="form-badges">
      {can.evo && pill("evo", "Evo")}
      {can.hero && pill("hero", "Hero")}
    </div>
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
      <FormBadges e={e} />
    </div>
  );
}

/** One upgrade-ready card: how far the held copies go right now, the gold for that, and what's left to max. */
function ReadyCard({ e }: { e: CollectionEntry }) {
  const to = e.level! + e.upgradableLevels;
  const left = e.maxLevel - to;
  return (
    <li class="ready-card">
      <CardIcon card={view(e)} size="md" />
      <div class="ready-info">
        <div class="coll-name" title={e.name}>
          {e.name}
        </div>
        <div class="ready-levels">
          Lv {e.level} → {to} <span class="pos">(+{e.upgradableLevels})</span>
        </div>
        <div class="gold">{formatNumber(e.upgradableGold)} gold</div>
        <div class="muted small">{left > 0 ? `${left} to max` : "max after this"}</div>
      </div>
    </li>
  );
}

export const collectionPages = new Hono<AppEnv>().use("/collection/*", requireUser).get("/collection", (c) => {
  const { current: player } = resolvePlayer(c);
  if (!player) {
    return renderPage(
      c,
      { title: "Collection", active: "collection" },
      <EmptyState title="No Players Linked Yet">
        <a class="btn" href="/settings">
          Link a Player
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
        <EmptyState title="No Collection Data Yet">
          <p class="muted">This player hasn't synced successfully.</p>
          {player.lastSyncError && <p class="error-text">Last error: {player.lastSyncError}</p>}
        </EmptyState>
      </div>,
    );
  }
  const f = parseQuery(c, filterSchema);
  const order = f.order ?? DEFAULT_ORDER[f.sort];
  const { entries, summary } = buildCollection(snapshot.player, listCards());
  const q = f.q.trim().toLowerCase();
  const onlyReady = f.ready === "1";
  const onlyMissing = f.missing === "1";
  const shown = sortCollection(
    entries.filter(
      (e) => (!q || e.name.toLowerCase().includes(q)) && (!onlyReady || e.upgradeReady) && (!onlyMissing || !e.owned),
    ),
    // Rarity groups into sections below, so inside each section it's alphabetical.
    f.sort === "rarity" ? "name" : f.sort,
    f.sort === "rarity" ? "asc" : order,
  );
  const ready = sortCollection(
    entries.filter((e) => e.upgradeReady),
    "upgradable",
    "desc",
  );
  const cards = shown.filter((e) => e.kind === "card");
  const towers = shown.filter((e) => e.kind === "support");
  let sections: { title: string; items: CollectionEntry[] }[];
  if (f.sort === "rarity") {
    const extraRarities = [...new Set(cards.map((e) => e.rarity))].filter((r) => !RARITY_ORDER.includes(r));
    const rarities = [...RARITY_ORDER, ...extraRarities];
    if (order === "desc") rarities.reverse();
    sections = rarities.map((r) => ({ title: r, items: cards.filter((e) => e.rarity === r) }));
  } else {
    sections = [{ title: "Cards", items: cards }];
  }
  sections = [...sections, { title: "Tower Troops", items: towers }].filter((s) => s.items.length > 0);
  const filtered = Boolean(q || onlyReady || onlyMissing);
  const nextOrder = order === "asc" ? "desc" : "asc";
  const orderLabel = order === "asc" ? "Ascending" : "Descending";

  return renderPage(
    c,
    { title: "Collection", active: "collection" },
    <div class="stack">
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
        <StatTile label="Upgrade Ready" value={summary.upgradeReady} />
        {summary.byRarity.map((r) => (
          <StatTile
            label={r.rarity}
            value={`${r.owned}/${r.total}`}
            hint={r.avgLevel === null ? undefined : `avg level ${r.avgLevel.toFixed(1)}`}
          />
        ))}
      </div>

      <form method="get" action="/collection" class="filters" data-live-filter>
        <div class="field field-search">
          <label for="q">Search</label>
          <input type="search" id="q" name="q" value={f.q} placeholder="Card name" autocomplete="off" />
        </div>
        <div class="field">
          <label for="sort">Sort By</label>
          <div class="sort-control">
            <select id="sort" name="sort">
              {COLLECTION_SORTS.map((s) => (
                <option value={s} selected={f.sort === s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
            <input type="hidden" name="order" value={f.order ?? ""} />
            {/* A link so it works without JS; app.js flips the hidden input instead and refreshes in place. */}
            <a
              id="order-toggle"
              class="btn btn-secondary order-toggle"
              href={collectionHref(f, { order: nextOrder })}
              data-order-toggle
              data-next-order={nextOrder}
              data-live-swap
              aria-label={`Order: ${orderLabel}. Switch to ${nextOrder === "asc" ? "ascending" : "descending"}.`}
              title={`${orderLabel}. Click to reverse.`}
            >
              {order === "asc" ? <SortAscIcon /> : <SortDescIcon />}
              <span>{order === "asc" ? "Asc" : "Desc"}</span>
            </a>
          </div>
        </div>
        <div class="filter-checks">
          <label class="check">
            <input type="checkbox" name="ready" value="1" checked={onlyReady} /> Upgrade Ready
          </label>
          <label class="check">
            <input type="checkbox" name="missing" value="1" checked={onlyMissing} /> Missing
          </label>
        </div>
        <div class="filter-actions">
          <noscript>
            <button type="submit">Apply</button>
          </noscript>
          <a
            id="collection-clear"
            class="btn btn-ghost"
            href={collectionHref(f, { q: "", ready: undefined, missing: undefined })}
            data-live-clear
            data-live-swap
            hidden={!filtered}
          >
            Clear
          </a>
        </div>
      </form>

      <div id="collection-results" class="stack live-results" data-live-swap>
        {ready.length > 0 && !filtered && (
          <section class="card">
            <h2>
              Upgrade Ready <span class="muted small">{ready.length}</span>
            </h2>
            <ul class="ready-strip">
              {ready.map((e) => (
                <ReadyCard e={e} />
              ))}
            </ul>
          </section>
        )}

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
      </div>
    </div>,
  );
});
