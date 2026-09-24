import type { Child } from "hono/jsx";
import type { BattleResult } from "../repos/battles";
import type { CardRecord } from "../repos/cards";

/** What the card components need. Build from battle DeckCards, deck names, or player cards via toCardView. */
export interface CardView {
  name: string;
  iconUrl?: string | null;
  iconUrlEvo?: string | null;
  /** Display level (1–16 scale). */
  level?: number;
  evolutionLevel?: number;
  elixirCost?: number | null;
}

export function toCardView(
  card: { name: string; level?: number; evolutionLevel?: number },
  catalog: Map<string, CardRecord>,
): CardView {
  const c = catalog.get(card.name);
  return {
    name: card.name,
    iconUrl: c?.iconUrl ?? null,
    iconUrlEvo: c?.iconUrlEvo ?? null,
    level: card.level,
    evolutionLevel: card.evolutionLevel,
    elixirCost: c?.elixirCost ?? null,
  };
}

export type CardSize = "sm" | "md" | "lg";

export function CardIcon({ card, size = "md" }: { card: CardView; size?: CardSize }) {
  const evolved = (card.evolutionLevel ?? 0) > 0;
  const src = (evolved && card.iconUrlEvo) || card.iconUrl;
  return (
    <figure class={`card-icon size-${size}${evolved ? " evolved" : ""}`} title={card.name}>
      {/* The name is always rendered; CSS hides it behind the image and app.js reveals it if the image fails. */}
      {src && <img src={src} alt={card.name} loading="lazy" />}
      <span class="card-fallback">{card.name}</span>
      {card.level !== undefined && <span class="card-level">Lv {card.level}</span>}
      {evolved && <span class="card-evo">EVO</span>}
    </figure>
  );
}

export function DeckGrid({ cards, size = "md" }: { cards: CardView[]; size?: CardSize }) {
  return (
    <div class={`deck-grid size-${size}`}>
      {cards.map((card) => (
        <CardIcon card={card} size={size} />
      ))}
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: Child; hint?: Child }) {
  return (
    <div class="stat-tile">
      <div class="stat-label">{label}</div>
      <div class="stat-value">{value}</div>
      {hint !== undefined && <div class="stat-hint">{hint}</div>}
    </div>
  );
}

export interface Column<T> {
  label: string;
  align?: "left" | "right" | "center";
  render: (row: T) => Child;
}

export function Table<T>({
  columns,
  rows,
  empty = "Nothing here yet.",
  rowAttrs,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: Child;
  rowAttrs?: (row: T) => Record<string, string>;
}) {
  if (rows.length === 0) return <p class="muted empty">{empty}</p>;
  return (
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th class={col.align ? `align-${col.align}` : undefined}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr {...rowAttrs?.(row)}>
              {columns.map((col) => (
                <td class={col.align ? `align-${col.align}` : undefined}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultBadge({ result }: { result: BattleResult }) {
  return <span class={`badge badge-${result}`}>{result}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: Child }) {
  return (
    <div class="empty-state card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
