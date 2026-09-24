import type { Child } from "hono/jsx";
import { tagSlug } from "../cr/tag";
import type { BattleRecord } from "../repos/battles";
import type { CardRecord } from "../repos/cards";
import { deckCardViews } from "./cardViews";
import { type Column, DeckGrid, ResultBadge, Table } from "./components";
import { formatDateTime, formatRelative, formatSigned } from "./format";

export const battleHref = (b: BattleRecord): string => `/battles/${tagSlug(b.playerTag)}/${b.id}`;

// Path of Legend game mode names are internal ids like "Ranked1v1_NewArena2".
export const modeLabel = (b: Pick<BattleRecord, "type" | "gameModeName">): string =>
  b.type === "pathOfLegend" ? "Path of Legend" : b.gameModeName;

function battleColumns(catalog: Map<string, CardRecord>): Column<BattleRecord>[] {
  return [
    {
      label: "Time",
      // The real link is the row's keyboard focus target and its no-JS fallback; app.js makes the whole row open it.
      render: (b) => (
        <a href={battleHref(b)} class="row-link" title={formatDateTime(b.battleTime)}>
          {formatRelative(b.battleTime)}
        </a>
      ),
    },
    { label: "Mode", render: (b) => modeLabel(b) },
    { label: "Result", render: (b) => <ResultBadge result={b.result} /> },
    { label: "Crowns", align: "center", render: (b) => `${b.teamCrowns}–${b.opponentCrowns}` },
    { label: "Opponent", render: (b) => b.opponentName || <span class="muted">unknown</span> },
    { label: "Your deck", render: (b) => <DeckGrid cards={deckCardViews(b.teamDeck.slice(0, 8), catalog)} size="sm" /> },
    {
      label: "Opponent deck",
      render: (b) => <DeckGrid cards={deckCardViews(b.opponentDeck.slice(0, 8), catalog)} size="sm" />,
    },
    {
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
    },
  ];
}

/** The one battle list used by the dashboard and the Battles page, so both look and behave the same. */
export function BattleTable({
  battles,
  catalog,
  empty,
}: {
  battles: BattleRecord[];
  catalog: Map<string, CardRecord>;
  empty: Child;
}) {
  return (
    <Table
      columns={battleColumns(catalog)}
      rows={battles}
      empty={empty}
      rowAttrs={(b) => ({ class: "battle-row", "data-href": battleHref(b) })}
    />
  );
}
