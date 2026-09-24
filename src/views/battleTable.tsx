import { tagSlug } from "../cr/tag";
import type { BattleRecord } from "../repos/battles";
import type { CardRecord } from "../repos/cards";
import { deckCardViews } from "./cardViews";
import { type Column, DeckGrid, ResultBadge } from "./components";
import { formatDateTime, formatRelative, formatSigned } from "./format";

export const battleHref = (b: BattleRecord): string => `/battles/${tagSlug(b.playerTag)}/${b.id}`;

// Path of Legend game mode names are internal ids like "Ranked1v1_NewArena2".
export const modeLabel = (b: Pick<BattleRecord, "type" | "gameModeName">): string =>
  b.type === "pathOfLegend" ? "Path of Legend" : b.gameModeName;

/** Shared columns for battle lists; `decks` adds the two small deck grids (own 8 cards only). */
export function battleColumns(catalog: Map<string, CardRecord>, { decks = false } = {}): Column<BattleRecord>[] {
  const cols: Column<BattleRecord>[] = [
    {
      label: "Time",
      render: (b) => (
        <a href={battleHref(b)} title={formatDateTime(b.battleTime)}>
          {formatRelative(b.battleTime)}
        </a>
      ),
    },
    { label: "Mode", render: (b) => modeLabel(b) },
    { label: "Result", render: (b) => <ResultBadge result={b.result} /> },
    { label: "Crowns", align: "center", render: (b) => `${b.teamCrowns}–${b.opponentCrowns}` },
    { label: "Opponent", render: (b) => b.opponentName || <span class="muted">unknown</span> },
  ];
  if (decks) {
    cols.push(
      { label: "Your deck", render: (b) => <DeckGrid cards={deckCardViews(b.teamDeck.slice(0, 8), catalog)} size="sm" /> },
      {
        label: "Opponent deck",
        render: (b) => <DeckGrid cards={deckCardViews(b.opponentDeck.slice(0, 8), catalog)} size="sm" />,
      },
    );
  }
  cols.push({
    label: "Trophies",
    align: "right",
    render: (b) =>
      b.trophyChange === null ? (
        <span class="muted">–</span>
      ) : (
        <span class={b.trophyChange > 0 ? "pos" : b.trophyChange < 0 ? "neg" : undefined}>
          {formatSigned(b.trophyChange)}
        </span>
      ),
  });
  return cols;
}
