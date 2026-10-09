import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireUser } from "../../auth/middleware";
import { cardType } from "../../domain/cardType";
import { buildCollection, type CollectionEntry, projectAffordable } from "../../domain/collection";
import { deckSlotForms, type SlotForms, slotFormsBitmask } from "../../domain/deckSlots";
import { classifyDecks, type UsedDeckStats } from "../../domain/deckUsage";
import { AppError, notFound } from "../../errors";
import { resolvePlayer } from "../../http/currentPlayer";
import { setFlash } from "../../http/flash";
import { parseForm, parseQuery } from "../../http/validate";
import { averageElixir, type BattleStats, getBattleStats } from "../../repos/battles";
import { cardsMap, listCards } from "../../repos/cards";
import {
  createDeck,
  DECK_SIZE,
  type DeckRecord,
  deleteDeck,
  getDeck,
  listDecks,
  MAX_DECK_TAG_CHARS,
  normalizeDeckTags,
  type SlotForm,
  updateDeck,
} from "../../repos/decks";
import { getLatestSnapshot } from "../../repos/players";
import type { AppEnv } from "../../types";
import { formatElixir, namedCardViews } from "../../views/cardViews";
import { CardIcon, DeckGrid, EmptyState, InfoTip, LocalTime, localTitle, ModeTags, toCardView } from "../../views/components";
import { formatPercent, formatRelative } from "../../views/format";
import { ArrowLeftIcon, CheckIcon, CloseIcon, PencilIcon, TrashIcon } from "../../views/icons";
import { renderPage } from "../../views/render";
import { formError, idParam } from "./shared";

const deckSchema = z.object({
  name: z.string().trim().min(1, "Give the deck a name").max(100),
  cards: z.union([z.string(), z.array(z.string())]).default([]),
  notes: z.string().max(20_000).default(""),
  slot3Form: z.enum(["evo", "hero"]).optional().catch(undefined),
  tags: z.union([z.string(), z.array(z.string())]).default([]),
});

interface DeckFormValues {
  name: string;
  cards: string[];
  notes: string;
  slot3Form: SlotForm | null;
  tags: string[];
}

function SourceBadge({ source }: { source: DeckRecord["source"] }) {
  return <span class={`badge badge-source-${source}`}>{source === "ai" ? "AI" : "manual"}</span>;
}

// Past this the page turns into a battle-log dump; the Battles page has the full history.
const MAX_USED_DECKS = 12;

const deckFilterSchema = z.object({
  mode: z.string().trim().max(100).catch(""),
  show: z.enum(["saved", "used"]).optional().catch(undefined),
});

/**
 * Deck stats carry mode tags, not labels, so a war sub-mode is offered by its tag ("Touchdown") and
 * shown under its group ("Clan War · Touchdown").
 */
export function deckModeOptions(byMode: BattleStats["byMode"]): { value: string; text: string }[] {
  const groups = new Map<string, Set<string>>();
  for (const m of byMode) {
    const [group = m.modeLabel, ...subs] = m.modeTags;
    const set = groups.get(group) ?? new Set<string>();
    for (const sub of subs) set.add(sub);
    groups.set(group, set);
  }
  return [...groups].flatMap(([group, subs]) => [
    { value: group, text: subs.size ? `${group} · All` : group },
    ...[...subs].map((sub) => ({ value: sub, text: `${group} · ${sub}` })),
  ]);
}

/** Concatenates tag lists, dropping later case-insensitive repeats so the first spelling wins. */
export function unionTags(...lists: string[][]): string[] {
  const seen = new Set<string>();
  return lists.flat().filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Saved-deck tags no battle has produced yet still need to be filterable, so they join the battle options. */
export function withDeckTagOptions(
  options: { value: string; text: string }[],
  tags: string[],
): { value: string; text: string }[] {
  const known = new Set(options.map((o) => o.value.toLowerCase()));
  const extra = unionTags(tags)
    .filter((t) => !known.has(t.toLowerCase()))
    .map((t) => ({ value: t, text: t }))
    .sort((a, b) => a.text.localeCompare(b.text));
  return [...options, ...extra];
}

const DECK_TAG_LABELS = { "in-use": "In Use", saved: "Saved", used: "Used" } as const;

function DeckTag({ kind }: { kind: keyof typeof DECK_TAG_LABELS }) {
  return <span class={`tag tag-${kind}`}>{DECK_TAG_LABELS[kind]}</span>;
}

function DeckLegend({ playerName }: { playerName: string | null }) {
  return (
    <ul class="deck-legend">
      {playerName && (
        <li>
          <DeckTag kind="in-use" /> equipped by {playerName} now
        </li>
      )}
      <li>
        <DeckTag kind="saved" /> saved in this app
      </li>
      <li>
        <SourceBadge source="ai" /> saved by your AI assistant through the API
      </li>
      {playerName && (
        <li>
          <DeckTag kind="used" /> played in {`${playerName}'s`} stored battles
        </li>
      )}
    </ul>
  );
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

interface DeckError {
  message: string;
  unknown?: string[];
  duplicates?: string[];
}

/**
 * Every playable card, which app.js reads as its client-side catalog: the card picker's grid and filters, and
 * redrawing tiles as cards change.
 * Level data comes from the player current in the header: decks belong to the user, not to a player.
 */
function CardDatalist({ byName }: { byName: Map<string, CollectionEntry> | null }) {
  return (
    <datalist id="card-names">
      {listCards({ kind: "card" }).map((card) => {
        const e = byName?.get(card.name);
        const to = e && e.level !== null ? projectAffordable(e).level : null;
        return (
          <option
            value={card.name}
            data-icon={card.iconUrl ?? undefined}
            data-icon-evo={card.iconUrlEvo ?? undefined}
            data-icon-hero={card.iconUrlHero ?? undefined}
            data-forms={String(card.maxEvolutionLevel ?? 0)}
            data-elixir={card.elixirCost === null ? undefined : String(card.elixirCost)}
            data-rarity={card.rarity}
            data-kind={cardType(card.id) ?? undefined}
            data-owned={e ? (e.owned ? "1" : "0") : undefined}
            data-level={e?.level == null ? undefined : String(e.level)}
            data-max={e ? String(e.maxLevel) : undefined}
            data-to={to === null ? undefined : String(to)}
            data-have={e?.owned ? String(e.evolutionLevel) : undefined}
          />
        );
      })}
    </datalist>
  );
}

const FORM_LABELS = { evo: "Evo", hero: "Hero" } as const;

/** app.js (slotFormsHtml) builds the same markup when a card changes, so keep the two in step. */
function SlotFormTags({ forms, editing }: { forms: SlotForms; editing: boolean }) {
  return (
    <div class="slot-forms">
      {forms.available.length > 1
        ? forms.available.map((f) => (
            <label class={`form-tag form-${f}`}>
              <input type="radio" name="slot3Form" value={f} checked={forms.active === f} disabled={!editing} />
              {FORM_LABELS[f]}
            </label>
          ))
        : forms.available.map((f) => <span class={`form-tag form-${f} is-active`}>{FORM_LABELS[f]}</span>)}
    </div>
  );
}

function DeckPage({
  deck,
  values,
  editing,
  error,
  levels,
  tagSuggestions,
}: {
  deck?: DeckRecord;
  values: DeckFormValues;
  editing: boolean;
  error?: DeckError;
  /** Offered as toggles besides the deck's own tags. */
  tagSuggestions: string[];
  /** Null when no player with a snapshot is linked; then there is no level switch. */
  levels: Map<string, CollectionEntry> | null;
}) {
  const catalog = cardsMap();
  const byLower = new Map([...catalog.keys()].map((n) => [n.toLowerCase(), n]));
  const slots = Array.from({ length: DECK_SIZE }, (_, i) => values.cards[i] ?? "");
  // Submitted values may differ in case from the catalog; the repo matches them case-insensitively too.
  const names = slots.map((v) => byLower.get(v.trim().toLowerCase()) ?? v.trim());
  const forms = deckSlotForms(names, catalog, values.slot3Form);
  const known = names.filter((n) => catalog.has(n));
  const action = deck ? `/decks/${deck.id}` : "/decks";
  const checkedTags = new Set(values.tags.map((t) => t.toLowerCase()));
  return (
    <form
      method="post"
      action={action}
      class="stack deck-page"
      data-deck-page
      data-mode={editing ? "edit" : "view"}
      data-deck-id={deck ? String(deck.id) : undefined}
    >
      <section class="card">
        <div class="row deck-head">
          <h1 id="deck-detail-title" class="view-only">
            {deck?.name ?? "New deck"}
          </h1>
          <input
            type="text"
            name="name"
            class="edit-only deck-name-input"
            value={values.name}
            maxlength={100}
            required
            placeholder="New deck"
            aria-label="Deck name"
            autocomplete="off"
          />
          {deck && <SourceBadge source={deck.source} />}
          <div class="spacer" />
          {levels && (
            <label class="switch" title="Show your card levels and the forms you own">
              <input type="checkbox" role="switch" data-level-toggle />
              My Cards
            </label>
          )}
          {deck && (
            <a class="icon-btn view-only" href={`${action}?edit=1`} data-deck-edit aria-label="Edit deck" title="Edit">
              <PencilIcon />
            </a>
          )}
          <button type="submit" class="icon-btn edit-only" aria-label="Save deck" title="Save">
            <CheckIcon />
          </button>
          <a class="icon-btn edit-only" href={deck ? action : "/decks"} data-deck-cancel aria-label="Cancel" title="Cancel">
            <CloseIcon />
          </a>
        </div>
        {error && (
          <div class="flash flash-error" role="alert">
            <p>{error.message}</p>
            {error.unknown?.length ? <p>Unknown cards: {error.unknown.join(", ")}</p> : null}
            {error.duplicates?.length ? <p>Duplicates: {error.duplicates.join(", ")}</p> : null}
          </div>
        )}
        <div class="deck-slots">
          {slots.map((raw, i) => {
            const name = names[i]!;
            const view = toCardView({ name, evolutionLevel: slotFormsBitmask(forms[i]!) }, catalog);
            return (
              <div class="deck-slot" data-slot={String(i)}>
                <SlotFormTags forms={forms[i]!} editing={editing} />
                <CardIcon card={view} />
                <div class="slot-from muted small" />
                <input
                  type="text"
                  name="cards"
                  class="edit-only"
                  list="card-names"
                  value={raw}
                  autocomplete="off"
                  aria-label={`Card ${i + 1}`}
                />
              </div>
            );
          })}
        </div>
        <div class="row deck-meta">
          <span>
            Avg elixir <strong data-avg-elixir>{formatElixir(averageElixir(known, catalog))}</strong>
          </span>
          <div class="spacer" />
          {deck && (
            <span class="muted small">
              Created <LocalTime iso={deck.createdAt} /> · updated <LocalTime iso={deck.updatedAt} />
            </span>
          )}
        </div>
        {deck && deck.tags.length > 0 && (
          <div class="view-only deck-modes">
            <ModeTags tags={deck.tags} label="Modes" />
          </div>
        )}
        <div class="edit-only deck-modes" role="group" aria-labelledby="deck-modes-label">
          <span id="deck-modes-label" class="muted small">
            Modes
          </span>
          <div class="tag-choices" data-tag-choices>
            {unionTags(values.tags, tagSuggestions).map((t) => (
              <label class="tag-choice">
                <input type="checkbox" name="tags" value={t} checked={checkedTags.has(t.toLowerCase())} />
                {t}
              </label>
            ))}
          </div>
          {/* Also named "tags": without JS its comma-separated text is split into tags on the server. */}
          <input
            type="text"
            name="tags"
            class="tag-add"
            maxlength={MAX_DECK_TAG_CHARS}
            placeholder="Add a mode…"
            aria-label="Add a mode"
            autocomplete="off"
            data-tag-add
          />
        </div>
      </section>
      <section class="card">
        <h2>Notes</h2>
        <div class="view-only">
          <Notes notes={deck?.notes ?? ""} />
        </div>
        <textarea name="notes" class="edit-only" maxlength={20000} aria-label="Notes">
          {values.notes}
        </textarea>
      </section>
      <CardDatalist byName={levels} />
    </form>
  );
}

function currentLevels(c: Context<AppEnv>): Map<string, CollectionEntry> | null {
  const player = resolvePlayer(c).current;
  const snap = player ? getLatestSnapshot(player.tag) : null;
  return snap ? new Map(buildCollection(snap.player, listCards()).entries.map((e) => [e.name, e])) : null;
}

/** Modes the current player has battle stats for, then tags on the user's other decks. */
function tagSuggestions(c: Context<AppEnv>, deck?: DeckRecord): string[] {
  const player = resolvePlayer(c).current;
  const played = player ? getBattleStats(player.tag).byMode.flatMap((m) => m.modeTags) : [];
  const others = listDecks(currentUser(c).id).filter((d) => d.id !== deck?.id);
  return unionTags(played, ...others.map((d) => d.tags));
}

const isPartial = (c: Context<AppEnv>) => c.req.query("partial") === "1";

function renderDeckPage(
  c: Context<AppEnv>,
  opts: { deck?: DeckRecord; values: DeckFormValues; editing: boolean; error?: DeckError },
) {
  const status = opts.error ? 400 : 200;
  const page = <DeckPage {...opts} levels={currentLevels(c)} tagSuggestions={tagSuggestions(c, opts.deck)} />;
  // app.js loads this into the dialog and swaps it in after an in-place save; the query string keeps it a
  // separate cache entry from the page.
  if (isPartial(c)) {
    c.header("Cache-Control", "no-store");
    return c.html(page, status);
  }
  const title = !opts.deck ? "New Deck" : opts.editing ? `Edit ${opts.deck.name}` : opts.deck.name;
  return renderPage(
    c,
    { title, active: "decks", status },
    <div class="stack">
      <p>
        <a class="btn btn-ghost btn-small" href="/decks">
          <ArrowLeftIcon /> Back to Decks
        </a>
      </p>
      {page}
    </div>,
  );
}

const deckValues = (d: DeckRecord): DeckFormValues => ({
  name: d.name,
  cards: d.cards,
  notes: d.notes,
  slot3Form: d.slot3Form,
  tags: d.tags,
});

const splitTags = (raw: string[]) => normalizeDeckTags(raw.flatMap((s) => s.split(",")));

async function readDeckForm(c: Context<AppEnv>): Promise<DeckFormValues> {
  const form = await parseForm(c, deckSchema);
  const cards = (Array.isArray(form.cards) ? form.cards : [form.cards]).map((s) => s.trim()).filter(Boolean);
  const tags = splitTags(Array.isArray(form.tags) ? form.tags : [form.tags]);
  return { name: form.name, cards, notes: form.notes, slot3Form: form.slot3Form ?? null, tags };
}

/** Raw submitted values for re-rendering when schema validation itself failed. */
async function rawDeckValues(c: Context<AppEnv>): Promise<DeckFormValues> {
  const body = await c.req.parseBody({ all: true });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const cards = Array.isArray(body.cards) ? body.cards.map(str) : [str(body.cards)];
  const form = str(body.slot3Form);
  const tags = splitTags(Array.isArray(body.tags) ? body.tags.map(str) : [str(body.tags)]);
  return {
    name: str(body.name),
    cards,
    notes: str(body.notes),
    slot3Form: form === "evo" || form === "hero" ? form : null,
    tags,
  };
}

function deckFormError(err: unknown): DeckError {
  if (err instanceof AppError && err.code === "invalid_deck") {
    const d = err.details as { unknown?: string[]; duplicates?: string[]; count?: number } | undefined;
    const countMsg =
      d?.count !== undefined && d.count !== DECK_SIZE
        ? `A deck needs exactly ${DECK_SIZE} cards (got ${d.count}).`
        : "";
    return { message: countMsg || "Some cards aren't valid.", unknown: d?.unknown, duplicates: d?.duplicates };
  }
  return { message: formError(err) };
}

async function saveDeck(c: Context<AppEnv>, deck?: DeckRecord) {
  let values: DeckFormValues | undefined;
  try {
    values = await readDeckForm(c);
    const userId = currentUser(c).id;
    const input = { ...values, source: "manual" as const };
    const saved = deck ? updateDeck(userId, deck.id, input) : createDeck(userId, input);
    if (deck && isPartial(c)) return renderDeckPage(c, { deck: saved, values: deckValues(saved), editing: false });
    setFlash(c, "success", `Saved "${saved.name}".`);
    return c.redirect(`/decks/${saved.id}`);
  } catch (err) {
    const error = deckFormError(err);
    return renderDeckPage(c, { deck, values: values ?? (await rawDeckValues(c)), editing: true, error });
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
    const battleStats = player ? getBattleStats(player.tag) : null;
    const decks = listDecks(currentUser(c).id);
    const usage = classifyDecks(decks, battleStats?.byDeck ?? [], equipped);
    const f = parseQuery(c, deckFilterSchema);
    const modeOptions = withDeckTagOptions(
      battleStats ? deckModeOptions(battleStats.byMode) : [],
      decks.flatMap((d) => d.tags),
    );
    const modeText = modeOptions.find((o) => o.value === f.mode)?.text ?? f.mode;
    const playedIn = (s: UsedDeckStats | null) => !f.mode || (s?.modeTags.includes(f.mode) ?? false);
    const taggedWith = (d: DeckRecord) => d.tags.some((t) => t.toLowerCase() === f.mode.toLowerCase());
    const saved = usage.saved.filter((d) => playedIn(d.stats) || taggedWith(d.deck));
    const allUsed = usage.used.filter((d) => playedIn(d.stats));
    const used = allUsed.slice(0, MAX_USED_DECKS);
    const filtered = Boolean(f.mode || f.show);
    const playerName = player ? player.name || player.tag : null;
    const legendText = [
      playerName && `In Use: equipped by ${playerName} now.`,
      "Saved: saved in this app.",
      "AI: saved by your AI assistant through the API.",
      playerName && `Used: played in ${playerName}'s stored battles.`,
    ]
      .filter(Boolean)
      .join(" ");
    return renderPage(
      c,
      { title: "Decks", active: "decks" },
      <div class="stack">
        <div class="row">
          <div class="row title-with-tip">
            <h1>Decks</h1>
            <InfoTip align="start" text={legendText}>
              <DeckLegend playerName={playerName} />
            </InfoTip>
          </div>
          <div class="spacer" />
          <a class="btn" href="/decks/new">
            New Deck
          </a>
        </div>

        <form method="get" action="/decks" class="filters" data-live-filter>
          {modeOptions.length > 0 && (
            <div class="field">
              <label for="mode">Mode</label>
              <select id="mode" name="mode">
                <option value="">Any Mode</option>
                {modeOptions.map((o) => (
                  <option value={o.value} selected={f.mode === o.value}>
                    {o.text}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div class="field">
            <label for="show">Show</label>
            <select id="show" name="show">
              <option value="">All Decks</option>
              <option value="saved" selected={f.show === "saved"}>
                Saved
              </option>
              {player && (
                <option value="used" selected={f.show === "used"}>
                  Used in Battles
                </option>
              )}
            </select>
          </div>
          <div class="filter-actions">
            <noscript>
              <button type="submit">Apply</button>
            </noscript>
            {/* A plain link: a full load also resets the selects, which the live Clear only does for inputs. */}
            <a id="deck-clear" class="btn btn-ghost" href="/decks" data-live-swap hidden={!filtered}>
              Clear
            </a>
          </div>
        </form>

        <div id="deck-results" class="stack live-results" data-live-swap>
          {f.show !== "used" && (
            <section class="stack-tight">
              <h2>Saved Decks</h2>
              {saved.length ? (
                <div class="grid">
                  {saved.map(({ deck: d, stats, inUse }) => (
                    <article class={`card deck-card deck-saved${inUse ? " in-use" : ""}`}>
                      <div class="row deck-card-head">
                        <h3 class="deck-name">
                          <a href={`/decks/${d.id}`} data-modal="Deck">
                            {d.name}
                          </a>
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
                      <ModeTags
                        tags={unionTags(d.tags, stats?.modeTags ?? [])}
                        label={d.tags.length ? "Modes" : undefined}
                      />
                      {d.notes && (
                        <p class="muted excerpt">{d.notes.length > 140 ? `${d.notes.slice(0, 140)}…` : d.notes}</p>
                      )}
                      <div class="row deck-actions">
                        <a
                          class="icon-btn"
                          href={`/decks/${d.id}?edit=1`}
                          data-modal="Deck"
                          aria-label={`Edit ${d.name}`}
                          title="Edit"
                        >
                          <PencilIcon />
                        </a>
                        <form
                          method="post"
                          action={`/decks/${d.id}/delete`}
                          class="inline"
                          onsubmit="return confirm('Delete this deck?')"
                        >
                          <button
                            type="submit"
                            class="icon-btn icon-btn-danger"
                            aria-label={`Delete ${d.name}`}
                            title="Delete"
                          >
                            <TrashIcon />
                          </button>
                        </form>
                        <div class="spacer" />
                        <span class="muted small">updated {formatRelative(d.updatedAt)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : f.mode ? (
                <p class="muted">No saved deck is tagged or was played in {modeText}.</p>
              ) : (
                <EmptyState title="No Saved Decks Yet">
                  <p class="muted">Save decks here, or let your AI assistant save them through the API.</p>
                  <a class="btn" href="/decks/new">
                    New Deck
                  </a>
                </EmptyState>
              )}
            </section>
          )}

          {player && f.show !== "saved" && (
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
                          <span class="muted small" {...localTitle(stats.lastPlayed)}>
                            played {formatRelative(stats.lastPlayed)}
                          </span>
                        )}
                      </div>
                      <DeckGrid cards={namedCardViews(cards, catalog)} size="sm" />
                      <DeckStats stats={stats} avgElixir={averageElixir(cards, catalog)} tracked />
                      {stats && <ModeTags tags={stats.modeTags} />}
                    </article>
                  ))}
                </div>
              ) : (
                <p class="muted">
                  {f.mode
                    ? `No other deck was played in ${modeText}.`
                    : usage.saved.length
                      ? "Every deck played in stored battles is saved above."
                      : "No battles stored yet."}
                </p>
              )}
              {allUsed.length > used.length && (
                <p class="muted small">
                  Showing the {used.length} most recently played of {allUsed.length}.
                </p>
              )}
            </section>
          )}
        </div>
      </div>,
    );
  })
  .get("/decks/new", (c) =>
    renderDeckPage(c, { values: { name: "", cards: [], notes: "", slot3Form: null, tags: [] }, editing: true }),
  )
  .post("/decks", (c) => saveDeck(c))
  .get("/decks/:id{[0-9]+}", (c) => {
    const deck = loadDeck(c);
    return renderDeckPage(c, { deck, values: deckValues(deck), editing: c.req.query("edit") === "1" });
  })
  // The old edit page; links to it may live in bookmarks and the AI's notes.
  .get("/decks/:id{[0-9]+}/edit", (c) => c.redirect(`/decks/${loadDeck(c).id}?edit=1`))
  .post("/decks/:id{[0-9]+}", (c) => saveDeck(c, loadDeck(c)))
  .post("/decks/:id{[0-9]+}/delete", (c) => {
    const deck = loadDeck(c);
    deleteDeck(currentUser(c).id, deck.id);
    setFlash(c, "success", `Deleted "${deck.name}".`);
    return c.redirect("/decks");
  });
