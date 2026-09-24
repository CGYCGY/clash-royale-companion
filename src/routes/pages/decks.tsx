import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireUser } from "../../auth/middleware";
import { buildCollection, type CollectionEntry } from "../../domain/collection";
import { AppError, notFound } from "../../errors";
import { setFlash } from "../../http/flash";
import { parseForm } from "../../http/validate";
import { averageElixir } from "../../repos/battles";
import { cardsMap, listCards } from "../../repos/cards";
import { createDeck, DECK_SIZE, type DeckRecord, deleteDeck, getDeck, listDecks, updateDeck } from "../../repos/decks";
import { getLatestSnapshot, listPlayersForUser, type PlayerRecord } from "../../repos/players";
import type { AppEnv } from "../../types";
import { formatElixir, namedCardViews } from "../../views/cardViews";
import { DeckGrid, EmptyState } from "../../views/components";
import { formatDateTime, formatRelative } from "../../views/format";
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

function playerLevels(players: PlayerRecord[]): PlayerLevels[] {
  const catalog = listCards();
  return players.map((player) => {
    const snap = getLatestSnapshot(player.tag);
    const byName = snap ? new Map(buildCollection(snap.player, catalog).entries.map((e) => [e.name, e])) : null;
    return { player, byName };
  });
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
          <h3>Your levels</h3>
          <LevelCheck cards={values.cards.filter(Boolean)} levels={levels} />
        </div>
      )}
      <div class="row">
        <button type="submit">Save deck</button>
        <a href="/decks">Cancel</a>
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
  const title = opts.deck ? `Edit ${opts.deck.name}` : "New deck";
  const firstPlayer = listPlayersForUser(currentUser(c).id).slice(0, 1);
  return renderPage(
    c,
    { title, active: "decks", status: opts.error ? 400 : 200 },
    <div class="card">
      <h1>{title}</h1>
      <DeckForm
        action={opts.deck ? `/decks/${opts.deck.id}` : "/decks"}
        values={opts.values}
        error={opts.error}
        levels={opts.deck ? playerLevels(firstPlayer) : undefined}
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
    const decks = listDecks(currentUser(c).id);
    const catalog = cardsMap();
    return renderPage(
      c,
      { title: "Decks", active: "decks" },
      <div class="stack">
        <div class="row">
          <h1>Decks</h1>
          <div class="spacer" />
          <a class="btn" href="/decks/new">
            New deck
          </a>
        </div>
        {decks.length ? (
          <div class="grid">
            {decks.map((d) => (
              <article class="card deck-card">
                <div class="row">
                  <h2 class="deck-name">
                    <a href={`/decks/${d.id}`}>{d.name}</a>
                  </h2>
                  <div class="spacer" />
                  <SourceBadge source={d.source} />
                </div>
                <DeckGrid cards={namedCardViews(d.cards, catalog)} size="sm" />
                <div class="row deck-meta">
                  <span>
                    Avg elixir <strong>{formatElixir(averageElixir(d.cards, catalog))}</strong>
                  </span>
                  <span class="muted small">updated {formatRelative(d.updatedAt)}</span>
                </div>
                {d.notes && <p class="muted excerpt">{d.notes.length > 140 ? `${d.notes.slice(0, 140)}…` : d.notes}</p>}
                <div class="row">
                  <a href={`/decks/${d.id}/edit`}>Edit</a>
                  <form
                    method="post"
                    action={`/decks/${d.id}/delete`}
                    class="inline"
                    onsubmit="return confirm('Delete this deck?')"
                  >
                    <button type="submit" class="btn-link danger-link">
                      Delete
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No decks yet">
            <p class="muted">Save decks here, or let your AI assistant save them through the API.</p>
            <a class="btn" href="/decks/new">
              New deck
            </a>
          </EmptyState>
        )}
      </div>,
    );
  })
  .get("/decks/new", (c) => renderDeckForm(c, { values: { name: "", cards: [], notes: "" } }))
  .post("/decks", (c) => saveDeck(c))
  .get("/decks/:id{[0-9]+}", (c) => {
    const deck = loadDeck(c);
    const catalog = cardsMap();
    const levels = playerLevels(listPlayersForUser(currentUser(c).id));
    return renderPage(
      c,
      { title: deck.name, active: "decks" },
      <div class="stack">
        <p>
          <a href="/decks">Back to decks</a>
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
          <h2>Level check</h2>
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

