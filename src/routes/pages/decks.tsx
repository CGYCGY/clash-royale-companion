import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireUser } from "../../auth/middleware";
import { buildCollection, type CollectionEntry } from "../../domain/collection";
import { classifyDecks, type UsedDeckStats } from "../../domain/deckUsage";
import { AppError, notFound } from "../../errors";
import { resolvePlayer } from "../../http/currentPlayer";
import { setFlash } from "../../http/flash";
import { parseForm } from "../../http/validate";
import { averageElixir, getBattleStats } from "../../repos/battles";
import { cardsMap, listCards } from "../../repos/cards";
import { createDeck, DECK_SIZE, type DeckRecord, deleteDeck, getDeck, listDecks, updateDeck } from "../../repos/decks";
import { getLatestSnapshot, type PlayerRecord } from "../../repos/players";
import type { AppEnv } from "../../types";
import { formatElixir, namedCardViews } from "../../views/cardViews";
import { DeckGrid, EmptyState } from "../../views/components";
import { formatDateTime, formatPercent, formatRelative } from "../../views/format";
import { ArrowLeftIcon } from "../../views/icons";
import { renderPage } from "../../views/render";
import { formError, idParam } from "./shared";

const deckSchema = z.object({
  name: z.string().trim().min(1, "Give the deck a name").max(100),
  cards: z.union([z.string(), z.array(z.string())]).default([]),
  notes: z.string().max(20_000).default(""),
});

interface DeckFormValues {
  name: string;
  cards: string[];
  notes: string;
}

function SourceBadge({ source }: { source: DeckRecord["source"] }) {
  return <span class={`badge badge-source-${source}`}>{source === "ai" ? "AI" : "manual"}</span>;
}

// Past this the page turns into a battle-log dump; the Battles page has the full history.
const MAX_USED_DECKS = 12;

const DECK_TAG_LABELS = { "in-use": "In Use", saved: "Saved", used: "Used" } as const;

function DeckTag({ kind }: { kind: keyof typeof DECK_TAG_LABELS }) {
  return <span class={`tag tag-${kind}`}>{DECK_TAG_LABELS[kind]}</span>;
}

function DeckStats({
  stats,
  avgElixir,
  tracked,
}: {
  stats: UsedDeckStats | null;
  avgElixir: number | null;
  /** False when no player is linked, so "never played" would be meaningless. */
  tracked: boolean;
}) {
  return (
    <div class="row deck-meta">
      <span>
        <strong>{formatElixir(avgElixir)}</strong> elixir
      </span>
      {stats ? (
        <>
          <span>
            <strong>{stats.games}</strong> game{stats.games === 1 ? "" : "s"}
          </span>
          <span>
            <strong>{formatPercent(stats.winRate)}</strong> win
          </span>
          <span class="muted small">
            {stats.wins}W {stats.losses}L {stats.draws}D
          </span>
        </>
      ) : (
        tracked && <span class="muted small">no stored battles with this deck</span>
      )}
    </div>
  );
}

function Notes({ notes }: { notes: string }) {
  const paragraphs = notes
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paragraphs.length) return <p class="muted">No notes.</p>;
  return (
    <div class="notes">
      {paragraphs.map((p) => (
        <p>{p}</p>
      ))}
    </div>
  );
}

interface PlayerLevels {
  player: PlayerRecord;
  byName: Map<string, CollectionEntry> | null;
}

/**
 * Decks belong to the user, not to a player, so the same deck is checked against whichever player is
 * current in the header (empty when none is linked).
 */
function currentPlayerLevels(c: Context<AppEnv>): PlayerLevels[] {
  const player = resolvePlayer(c).current;
  if (!player) return [];
  const snap = getLatestSnapshot(player.tag);
  const byName = snap ? new Map(buildCollection(snap.player, listCards()).entries.map((e) => [e.name, e])) : null;
  return [{ player, byName }];
}

function LevelCell({ entry }: { entry: CollectionEntry | undefined }) {
  if (!entry || !entry.owned || entry.level === null) return <span class="neg">not owned</span>;
  const maxed = entry.level >= entry.maxLevel;
  return (
    <span class={maxed ? "pos" : undefined}>
      {entry.level}
      <span class="muted"> / {entry.maxLevel}</span>
    </span>
  );
}

function LevelCheck({ cards, levels }: { cards: string[]; levels: PlayerLevels[] }) {
  if (!levels.length) return <p class="muted">Link a player in Settings to compare card levels.</p>;
  return (
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Card</th>
            {levels.map((l) => (
              <th class="align-right">{l.player.name || l.player.tag}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cards.map((name) => (
            <tr>
              <td>{name}</td>
              {levels.map((l) => (
                <td class="align-right">
                  {l.byName ? <LevelCell entry={l.byName.get(name)} /> : <span class="muted">no data</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeckForm({
  action,
  values,
  error,
  levels,
}: {
  action: string;
  values: DeckFormValues;
  error?: { message: string; unknown?: string[]; duplicates?: string[] };
  levels?: PlayerLevels[];
}) {
  const cardNames = listCards({ kind: "card" }).map((c) => c.name);
  const slots = Array.from({ length: DECK_SIZE }, (_, i) => values.cards[i] ?? "");
  return (
    <form method="post" action={action} class="stack deck-form">
      {error && (
        <div class="flash flash-error" role="alert">
          <p>{error.message}</p>
          {error.unknown?.length ? <p>Unknown cards: {error.unknown.join(", ")}</p> : null}
          {error.duplicates?.length ? <p>Duplicates: {error.duplicates.join(", ")}</p> : null}
        </div>
      )}
      <div class="field">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" value={values.name} maxlength={100} required />
      </div>
      <fieldset class="field">
        <legend>Cards</legend>
        <datalist id="card-names">
          {cardNames.map((n) => (
            <option value={n} />
          ))}
        </datalist>
        <div class="card-inputs">
          {slots.map((v, i) => (
            <input type="text" name="cards" value={v} list="card-names" aria-label={`Card ${i + 1}`} autocomplete="off" />
          ))}
        </div>
      </fieldset>
      <div class="field">
        <label for="notes">Notes</label>
        <textarea id="notes" name="notes" maxlength={20000}>
          {values.notes}
        </textarea>
      </div>
      {levels && (
        <div class="field">
          <h3>Your Levels</h3>
          <LevelCheck cards={values.cards.filter(Boolean)} levels={levels} />
        </div>
      )}
      <div class="row">
        <button type="submit">Save Deck</button>
        <a class="btn btn-secondary" href="/decks">
          Cancel
        </a>
      </div>
    </form>
  );
}

async function readDeckForm(c: Context<AppEnv>): Promise<DeckFormValues> {
  const form = await parseForm(c, deckSchema);
  const cards = (Array.isArray(form.cards) ? form.cards : [form.cards]).map((s) => s.trim()).filter(Boolean);
  return { name: form.name, cards, notes: form.notes };
}

/** Raw submitted values for re-rendering when schema validation itself failed. */
async function rawDeckValues(c: Context<AppEnv>): Promise<DeckFormValues> {
  const body = await c.req.parseBody({ all: true });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const cards = Array.isArray(body.cards) ? body.cards.map(str) : [str(body.cards)];
  return { name: str(body.name), cards, notes: str(body.notes) };
}

function deckFormError(err: unknown) {
  if (err instanceof AppError && err.code === "invalid_deck") {
    const d = err.details as { unknown?: string[]; duplicates?: string[]; count?: number } | undefined;
    const countMsg =
      d?.count !== undefined && d.count !== DECK_SIZE ? `A deck needs exactly ${DECK_SIZE} cards (got ${d.count}).` : "";
    return { message: countMsg || "Some cards aren't valid.", unknown: d?.unknown, duplicates: d?.duplicates };
  }
  return { message: formError(err) };
}

function renderDeckForm(
  c: Context<AppEnv>,
  opts: { deck?: DeckRecord; values: DeckFormValues; error?: ReturnType<typeof deckFormError> },
) {
  const title = opts.deck ? `Edit ${opts.deck.name}` : "New Deck";
  return renderPage(
    c,
    { title, active: "decks", status: opts.error ? 400 : 200 },
    <div class="card">
      <h1>{title}</h1>
      <DeckForm
        action={opts.deck ? `/decks/${opts.deck.id}` : "/decks"}
        values={opts.values}
        error={opts.error}
        levels={opts.deck ? currentPlayerLevels(c) : undefined}
      />
    </div>,
  );
}

async function saveDeck(c: Context<AppEnv>, deck?: DeckRecord) {
  let values: DeckFormValues | undefined;
  try {
    values = await readDeckForm(c);
    const userId = currentUser(c).id;
    const input = { ...values, source: "manual" as const };
    const saved = deck ? updateDeck(userId, deck.id, input) : createDeck(userId, input);
    setFlash(c, "success", `Saved "${saved.name}".`);
    return c.redirect(`/decks/${saved.id}`);
  } catch (err) {
    const error = deckFormError(err);
    return renderDeckForm(c, { deck, values: values ?? (await rawDeckValues(c)), error });
  }
}

function loadDeck(c: Context<AppEnv>): DeckRecord {
  const deck = getDeck(currentUser(c).id, idParam(c.req.param("id") ?? ""));
  if (!deck) throw notFound("Deck");
  return deck;
}

export const deckPages = new Hono<AppEnv>()
  .use("/decks/*", requireUser)
  .get("/decks", (c) => {
    // Also keeps old /decks?tag= links selecting their player.
    const player = resolvePlayer(c).current;
    const catalog = cardsMap();
    const snapshot = player ? getLatestSnapshot(player.tag) : null;
    const equipped = snapshot?.player.currentDeck?.map((card) => card.name) ?? null;
    const usage = classifyDecks(listDecks(currentUser(c).id), player ? getBattleStats(player.tag).byDeck : [], equipped);
    const used = usage.used.slice(0, MAX_USED_DECKS);
    const playerName = player ? player.name || player.tag : null;
    return renderPage(
      c,
      { title: "Decks", active: "decks" },
      <div class="stack">
        <div class="row">
          <h1>Decks</h1>
          <div class="spacer" />
          <a class="btn" href="/decks/new">
            New Deck
          </a>
        </div>
        <ul class="deck-legend" aria-label="Legend">
          {playerName && (
            <li>
              <DeckTag kind="in-use" /> equipped by {playerName} now
            </li>
          )}
          <li>
            <DeckTag kind="saved" /> saved in this app
          </li>
          {playerName && (
            <li>
              <DeckTag kind="used" /> played in {`${playerName}'s`} stored battles
            </li>
          )}
        </ul>

        <section class="stack-tight">
          <h2>Saved Decks</h2>
          {usage.saved.length ? (
            <div class="grid">
              {usage.saved.map(({ deck: d, stats, inUse }) => (
                <article class={`card deck-card deck-saved${inUse ? " in-use" : ""}`}>
                  <div class="row deck-card-head">
                    <h3 class="deck-name">
                      <a href={`/decks/${d.id}`}>{d.name}</a>
                    </h3>
                    <div class="spacer" />
                    <span class="deck-tags">
                      {inUse && <DeckTag kind="in-use" />}
                      <DeckTag kind="saved" />
                      <SourceBadge source={d.source} />
                    </span>
                  </div>
                  <DeckGrid cards={namedCardViews(d.cards, catalog)} size="sm" />
                  <DeckStats stats={stats} avgElixir={averageElixir(d.cards, catalog)} tracked={player !== null} />
                  {d.notes && <p class="muted excerpt">{d.notes.length > 140 ? `${d.notes.slice(0, 140)}…` : d.notes}</p>}
                  <div class="row deck-actions">
                    <a class="btn btn-secondary btn-small" href={`/decks/${d.id}/edit`}>
                      Edit
                    </a>
                    <form
                      method="post"
                      action={`/decks/${d.id}/delete`}
                      class="inline"
                      onsubmit="return confirm('Delete this deck?')"
                    >
                      <button type="submit" class="btn-danger btn-small">
                        Delete
                      </button>
                    </form>
                    <div class="spacer" />
                    <span class="muted small">updated {formatRelative(d.updatedAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No Saved Decks Yet">
              <p class="muted">Save decks here, or let your AI assistant save them through the API.</p>
              <a class="btn" href="/decks/new">
                New Deck
              </a>
            </EmptyState>
          )}
        </section>

        {player && (
          <section class="stack-tight">
            <h2>
              Used in Battles <span class="muted small">{playerName}</span>
            </h2>
            {used.length ? (
              <div class="grid">
                {used.map(({ cards, stats, inUse }) => (
                  <article class={`card deck-card deck-used${inUse ? " in-use" : ""}`}>
                    <div class="row deck-card-head">
                      <span class="deck-tags">
                        {inUse && <DeckTag kind="in-use" />}
                        <DeckTag kind="used" />
                      </span>
                      <div class="spacer" />
                      {stats && (
                        <span class="muted small" title={formatDateTime(stats.lastPlayed)}>
                          played {formatRelative(stats.lastPlayed)}
                        </span>
                      )}
                    </div>
                    <DeckGrid cards={namedCardViews(cards, catalog)} size="sm" />
                    <DeckStats stats={stats} avgElixir={averageElixir(cards, catalog)} tracked />
                  </article>
                ))}
              </div>
            ) : (
              <p class="muted">
                {usage.saved.length ? "Every deck played in stored battles is saved above." : "No battles stored yet."}
              </p>
            )}
            {usage.used.length > used.length && (
              <p class="muted small">
                Showing the {used.length} most recently played of {usage.used.length}.
              </p>
            )}
          </section>
        )}
      </div>,
    );
  })
  .get("/decks/new", (c) => renderDeckForm(c, { values: { name: "", cards: [], notes: "" } }))
  .post("/decks", (c) => saveDeck(c))
  .get("/decks/:id{[0-9]+}", (c) => {
    const deck = loadDeck(c);
    const catalog = cardsMap();
    const levels = currentPlayerLevels(c);
    return renderPage(
      c,
      { title: deck.name, active: "decks" },
      <div class="stack">
        <p>
          <a class="btn btn-ghost btn-small" href="/decks">
            <ArrowLeftIcon /> Back to Decks
          </a>
        </p>
        <section class="card">
          <div class="row">
            <h1>{deck.name}</h1>
            <SourceBadge source={deck.source} />
            <div class="spacer" />
            <a class="btn btn-secondary" href={`/decks/${deck.id}/edit`}>
              Edit
            </a>
          </div>
          <DeckGrid cards={namedCardViews(deck.cards, catalog)} size="md" />
          <div class="row deck-meta">
            <span>
              Avg elixir <strong>{formatElixir(averageElixir(deck.cards, catalog))}</strong>
            </span>
            <span class="muted small">
              Created {formatDateTime(deck.createdAt)} · updated {formatDateTime(deck.updatedAt)}
            </span>
          </div>
        </section>
        <section class="card">
          <h2>Notes</h2>
          <Notes notes={deck.notes} />
        </section>
        <section class="card">
          <h2>Level Check</h2>
          <LevelCheck cards={deck.cards} levels={levels} />
        </section>
      </div>,
    );
  })
  .get("/decks/:id{[0-9]+}/edit", (c) => {
    const deck = loadDeck(c);
    return renderDeckForm(c, { deck, values: { name: deck.name, cards: deck.cards, notes: deck.notes } });
  })
  .post("/decks/:id{[0-9]+}", (c) => saveDeck(c, loadDeck(c)))
  .post("/decks/:id{[0-9]+}/delete", (c) => {
    const deck = loadDeck(c);
    deleteDeck(currentUser(c).id, deck.id);
    setFlash(c, "success", `Deleted "${deck.name}".`);
    return c.redirect("/decks");
  });

