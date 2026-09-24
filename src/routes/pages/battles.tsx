import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireUser } from "../../auth/middleware";
import { normalizeTag, tagSlug } from "../../cr/tag";
import { notFound } from "../../errors";
import { parseQuery } from "../../http/validate";
import { type BattleFilter, countBattles, getBattle, getBattleStats, listBattles } from "../../repos/battles";
import { cardsMap } from "../../repos/cards";
import { assertPlayerOwnedBy } from "../../repos/players";
import type { AppEnv } from "../../types";
import { daysAgoIso } from "../../util";
import { battleColumns, modeLabel } from "../../views/battleTable";
import { deckCardViews, formatElixir, namedCardViews } from "../../views/cardViews";
import { DeckGrid, EmptyState, ResultBadge, StatTile, Table } from "../../views/components";
import { formatDateTime, formatPercent, formatSigned } from "../../views/format";
import { PlayerSwitcher, resolvePlayer } from "../../views/playerSelect";
import { renderPage } from "../../views/render";
import { idParam } from "./shared";

const PAGE_SIZE = 50;
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

function queryString(f: Filters, tagSlugValue: string, page: number): string {
  const q = new URLSearchParams({ tag: tagSlugValue, days: f.days });
  if (f.mode) q.set("mode", f.mode);
  if (f.result) q.set("result", f.result);
  if (page > 1) q.set("page", String(page));
  return q.toString();
}

export const battlePages = new Hono<AppEnv>()
  .use("/battles/*", requireUser)
  .get("/battles", (c) => {
    const { players, player } = resolvePlayer(c);
    if (!player) {
      return renderPage(
        c,
        { title: "Battles", active: "battles" },
        <EmptyState title="No players linked yet">
          <a class="btn" href="/settings">
            Link a player
          </a>
        </EmptyState>,
      );
    }
    const f = parseQuery(c, filterSchema);
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
    const slug = tagSlug(player.tag);
    const windowLabel = sinceDays === undefined ? "All time" : `Last ${sinceDays} days`;
    const topDecks = stats.byDeck.filter((d) => d.cards.length).slice(0, 8);

    return renderPage(
      c,
      { title: "Battles", active: "battles" },
      <div class="stack">
        <PlayerSwitcher players={players} active={player} basePath="/battles" />
        <h1>Battles</h1>
        <form method="get" action="/battles" class="filters">
          <input type="hidden" name="tag" value={slug} />
          <div class="field">
            <label for="mode">Mode</label>
            <select id="mode" name="mode">
              <option value="">All modes</option>
              {modes.map((m) => (
                <option value={m.mode} selected={f.mode === m.mode}>
                  {modeLabel({ type: m.type, gameModeName: m.mode })}
                  {m.type === "pathOfLegend" ? ` (${m.mode})` : ""}
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
                  {d === "all" ? "All time" : `Last ${d} days`}
                </option>
              ))}
            </select>
          </div>
          <div class="filter-actions">
            <button type="submit">Filter</button>
          </div>
        </form>

        <div class="stats">
          <StatTile label="Win rate" value={stats.total ? formatPercent(stats.winRate) : "–"} hint={windowLabel} />
          <StatTile label="Games" value={stats.total} hint={`${stats.wins}W ${stats.losses}L ${stats.draws}D`} />
          <StatTile label="Net trophies" value={formatSigned(stats.netTrophies)} hint="ladder" />
        </div>

        {topDecks.length > 0 && (
          <section>
            <h2>Decks used</h2>
            <div class="grid">
              {topDecks.map((d) => (
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
            {total} battle{total === 1 ? "" : "s"}
            {pages > 1 && (
              <span class="muted small">
                {" "}
                · page {page} of {pages}
              </span>
            )}
          </h2>
          <Table
            columns={battleColumns(catalog, { decks: true })}
            rows={battles}
            empty="No battles match these filters."
          />
          {pages > 1 && (
            <nav class="pager">
              {page > 1 ? <a href={`/battles?${queryString(f, slug, page - 1)}`}>Newer</a> : <span />}
              {page < pages ? <a href={`/battles?${queryString(f, slug, page + 1)}`}>Older</a> : <span />}
            </nav>
          )}
        </section>
      </div>,
    );
  })
  .get("/battles/:tag/:id", (c) => {
    const tag = normalizeTag(c.req.param("tag"));
    assertPlayerOwnedBy(tag, currentUser(c).id);
    const battle = getBattle(tag, idParam(c.req.param("id")));
    if (!battle) throw notFound("Battle");
    const catalog = cardsMap();
    const half = (cards: typeof battle.teamDeck, i: number) => cards.slice(i * 8, i * 8 + 8);
    const teamNames = battle.raw.team.map((p) => p.name);
    const oppNames = battle.raw.opponent.map((p) => p.name);
    const sides = [
      { title: "Your team", names: teamNames, deck: battle.teamDeck, crowns: battle.teamCrowns },
      { title: "Opponent", names: oppNames, deck: battle.opponentDeck, crowns: battle.opponentCrowns },
    ];
    return renderPage(
      c,
      { title: "Battle", active: "battles" },
      <div class="stack">
        <p>
          <a href={`/battles?tag=${tagSlug(tag)}`}>Back to battles</a>
        </p>
        <section class="card">
          <div class="row">
            <h1 class="battle-title">
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
              <dd>{modeLabel(battle)}</dd>
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
          <summary>Raw battle data</summary>
          <pre>{JSON.stringify(battle.raw, null, 2)}</pre>
        </details>
      </div>,
    );
  });
