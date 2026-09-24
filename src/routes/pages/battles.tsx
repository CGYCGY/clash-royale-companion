import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireUser } from "../../auth/middleware";
import { normalizeTag, tagSlug } from "../../cr/tag";
import { notFound } from "../../errors";
import { parseQuery } from "../../http/validate";
import { resolvePlayer } from "../../http/currentPlayer";
import {
  type BattleFilter,
  countBattles,
  getBattle,
  getBattleStats,
  listBattles,
  modeLabelFor,
} from "../../repos/battles";
import { type CardRecord, cardsMap } from "../../repos/cards";
import { assertPlayerOwnedBy } from "../../repos/players";
import type { AppEnv } from "../../types";
import { daysAgoIso } from "../../util";
import { BattleTable } from "../../views/battleTable";
import { deckCardViews, formatElixir, namedCardViews } from "../../views/cardViews";
import { DeckGrid, EmptyState, ResultBadge, StatTile } from "../../views/components";
import { formatDateTime, formatPercent, formatSigned } from "../../views/format";
import { ArrowLeftIcon } from "../../views/icons";
import { renderPage } from "../../views/render";
import { idParam } from "./shared";

const PAGE_SIZE = 10;
const RECENT_DECKS = 3;
const DAY_OPTIONS = ["7", "30", "90", "all"] as const;
const RESULT_OPTIONS = [
  ["win", "Win"],
  ["loss", "Loss"],
  ["draw", "Draw"],
] as const;

// Lenient: a bad or stale filter value falls back to its default instead of erroring the page.
const filterSchema = z.object({
  tag: z.string().optional(),
  mode: z.string().max(100).optional().catch(undefined),
  result: z.enum(["win", "loss", "draw"]).optional().catch(undefined),
  days: z.enum(DAY_OPTIONS).default("30").catch("30"),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
type Filters = z.infer<typeof filterSchema>;

function battlesHref(f: Filters, page: number): string {
  return `/battles?${queryString(f, page)}`;
}

/**
 * Page numbers to show: first, last, and a window around the current one, with null for a gap. A gap
 * that would hide a single page shows that page instead, since "…" takes the same room.
 */
export function pageList(page: number, pages: number, window = 1): (number | null)[] {
  const shown = (p: number) => p === 1 || p === pages || Math.abs(p - page) <= window;
  const out: (number | null)[] = [];
  for (let p = 1; p <= pages; p++) {
    if (shown(p) || (shown(p - 1) && shown(p + 1))) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

function Pager({ f, page, pages }: { f: Filters; page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav class="pager" aria-label="Pagination">
      {page > 1 ? (
        <a class="btn btn-secondary btn-small" href={battlesHref(f, page - 1)} rel="prev">
          Prev
        </a>
      ) : (
        <span class="btn btn-secondary btn-small is-disabled" aria-disabled="true">
          Prev
        </span>
      )}
      <span class="pager-pages">
        {pageList(page, pages).map((p) =>
          p === null ? (
            <span class="pager-gap" aria-hidden="true">
              …
            </span>
          ) : p === page ? (
            <span class="btn btn-small pager-current" aria-current="page">
              {p}
            </span>
          ) : (
            <a class="btn btn-ghost btn-small" href={battlesHref(f, p)} aria-label={`Page ${p}`}>
              {p}
            </a>
          ),
        )}
      </span>
      <span class="pager-status muted small">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <a class="btn btn-secondary btn-small" href={battlesHref(f, page + 1)} rel="next">
          Next
        </a>
      ) : (
        <span class="btn btn-secondary btn-small is-disabled" aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}

function queryString(f: Filters, page: number): string {
  const q = new URLSearchParams({ days: f.days });
  if (f.mode) q.set("mode", f.mode);
  if (f.result) q.set("result", f.result);
  if (page > 1) q.set("page", String(page));
  return q.toString();
}

type BattleWithRaw = NonNullable<ReturnType<typeof getBattle>>;

function BattleDetail({ battle, catalog }: { battle: BattleWithRaw; catalog: Map<string, CardRecord> }) {
  const half = (cards: typeof battle.teamDeck, i: number) => cards.slice(i * 8, i * 8 + 8);
  const sides = [
    { title: "Your Team", names: battle.raw.team.map((p) => p.name), deck: battle.teamDeck, crowns: battle.teamCrowns },
    {
      title: "Opponent",
      names: battle.raw.opponent.map((p) => p.name),
      deck: battle.opponentDeck,
      crowns: battle.opponentCrowns,
    },
  ];
  return (
    <div class="stack battle-detail">
      <section class="card">
        <div class="row">
          <h1 class="battle-title" id="battle-detail-title">
            <ResultBadge result={battle.result} /> {battle.teamCrowns}–{battle.opponentCrowns}
          </h1>
          <div class="spacer" />
          {battle.trophyChange !== null && (
            <strong class={battle.trophyChange > 0 ? "pos" : battle.trophyChange < 0 ? "neg" : undefined}>
              {formatSigned(battle.trophyChange)} trophies
            </strong>
          )}
        </div>
        <dl class="facts">
          <div>
            <dt>Mode</dt>
            <dd>{battle.modeLabel}</dd>
          </div>
          <div>
            <dt>Arena</dt>
            <dd>{battle.arenaName ?? "–"}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{formatDateTime(battle.battleTime)}</dd>
          </div>
        </dl>
      </section>
      <div class="grid grid-2">
        {sides.map((s) => (
          <section class="card">
            <h2>
              {s.title} <span class="muted small">{s.crowns} crown{s.crowns === 1 ? "" : "s"}</span>
            </h2>
            {[0, 1]
              .filter((i) => half(s.deck, i).length > 0)
              .map((i) => (
                <div class="deck-block">
                  <div class="muted">{s.names[i] ?? ""}</div>
                  <DeckGrid cards={deckCardViews(half(s.deck, i), catalog)} size="md" />
                </div>
              ))}
          </section>
        ))}
      </div>
      <details class="card">
        <summary>Raw Battle Data</summary>
        <pre>{JSON.stringify(battle.raw, null, 2)}</pre>
      </details>
    </div>
  );
}

export const battlePages = new Hono<AppEnv>()
  .use("/battles/*", requireUser)
  .get("/battles", (c) => {
    const { current: player } = resolvePlayer(c);
    if (!player) {
      return renderPage(
        c,
        { title: "Battles", active: "battles" },
        <EmptyState title="No Players Linked Yet">
          <a class="btn" href="/settings">
            Link a Player
          </a>
        </EmptyState>,
      );
    }
    const parsed = parseQuery(c, filterSchema);
    // Links from before mode labels carry a raw type or game mode (?mode=Ladder); widen them to the
    // label so the dropdown, pager links and results all agree.
    const f = { ...parsed, mode: parsed.mode ? (modeLabelFor(player.tag, parsed.mode) ?? parsed.mode) : undefined };
    const sinceDays = f.days === "all" ? undefined : Number(f.days);
    const filter: BattleFilter = {
      since: sinceDays === undefined ? undefined : daysAgoIso(sinceDays),
      mode: f.mode || undefined,
      result: f.result,
    };
    const total = countBattles(player.tag, filter);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(f.page, pages);
    const battles = listBattles(player.tag, { ...filter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    // The result filter is deliberately left out: under result=win the tiles would just read 100%.
    const stats = getBattleStats(player.tag, { sinceDays, mode: filter.mode });
    const modes = getBattleStats(player.tag).byMode;
    const catalog = cardsMap();
    const windowLabel = sinceDays === undefined ? "All time" : `Last ${sinceDays} days`;
    const recentDecks = stats.byDeck
      .filter((d) => d.cards.length)
      .sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed))
      .slice(0, RECENT_DECKS);

    return renderPage(
      c,
      { title: "Battles", active: "battles" },
      <div class="stack">
        <h1>Battles</h1>
        <form method="get" action="/battles" class="filters" data-live-filter>
          <div class="field">
            <label for="mode">Mode</label>
            <select id="mode" name="mode">
              <option value="">All Modes</option>
              {modes.map((m) => (
                <option value={m.modeLabel} selected={f.mode === m.modeLabel}>
                  {m.modeLabel}
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <label for="result">Result</label>
            <select id="result" name="result">
              <option value="">Any</option>
              {RESULT_OPTIONS.map(([value, label]) => (
                <option value={value} selected={f.result === value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <label for="days">Period</label>
            <select id="days" name="days">
              {DAY_OPTIONS.map((d) => (
                <option value={d} selected={f.days === d}>
                  {d === "all" ? "All Time" : `Last ${d} Days`}
                </option>
              ))}
            </select>
          </div>
          <noscript>
            <div class="filter-actions">
              <button type="submit">Apply</button>
            </div>
          </noscript>
        </form>

        <div id="battles-results" class="stack live-results" data-live-swap>
          <div class="stats">
            <StatTile label="Win Rate" value={stats.total ? formatPercent(stats.winRate) : "–"} hint={windowLabel} />
            <StatTile label="Games" value={stats.total} hint={`${stats.wins}W ${stats.losses}L ${stats.draws}D`} />
            <StatTile label="Net Trophies" value={formatSigned(stats.netTrophies)} hint="ladder" />
          </div>
  
          {recentDecks.length > 0 && (
            <section>
              <h2>
                Decks Used <span class="muted small">most recent</span>
              </h2>
              <div class="grid">
                {recentDecks.map((d) => (
                  <div class="card deck-card">
                    <DeckGrid cards={namedCardViews(d.cards, catalog)} size="sm" />
                    <div class="row deck-meta">
                      <span>
                        <strong>{d.games}</strong> games
                      </span>
                      <span>
                        <strong>{formatPercent(d.winRate)}</strong> win
                      </span>
                      <span>
                        <strong>{formatElixir(d.avgElixir)}</strong> elixir
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
  
          <section>
            <h2>
              {total} Battle{total === 1 ? "" : "s"}
            </h2>
            <BattleTable battles={battles} catalog={catalog} empty="No battles match these filters." />
            <Pager f={f} page={page} pages={pages} />
          </section>
        </div>
      </div>,
    );
  })
  .get("/battles/:tag/:id", (c) => {
    const tag = normalizeTag(c.req.param("tag"));
    assertPlayerOwnedBy(tag, currentUser(c).id);
    const battle = getBattle(tag, idParam(c.req.param("id")));
    if (!battle) throw notFound("Battle");
    const detail = <BattleDetail battle={battle} catalog={cardsMap()} />;
    // app.js loads this into the battle dialog; the query string keeps it a separate cache entry from the page.
    if (c.req.query("partial") === "1") {
      c.header("Cache-Control", "no-store");
      return c.html(detail);
    }
    return renderPage(
      c,
      { title: "Battle", active: "battles" },
      <div class="stack">
        <p>
          <a class="btn btn-ghost btn-small" href={`/battles?tag=${tagSlug(tag)}`}>
            <ArrowLeftIcon /> Back to Battles
          </a>
        </p>
        {detail}
      </div>,
    );
  });
