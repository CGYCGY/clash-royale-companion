import { beforeEach, describe, expect, test } from "bun:test";
import type { Player } from "../../src/cr/types";
import { buildCollection } from "../../src/domain/collection";
import { renderContextMarkdown } from "../../src/domain/context";
import { copiesForNextLevel, copiesToMax, goldForNextLevel, goldToMax } from "../../src/domain/upgradeTable";
import { getBattleStats, listBattles } from "../../src/repos/battles";
import { listCards } from "../../src/repos/cards";
import type { DeckRecord } from "../../src/repos/decks";
import { addPlayer, getLatestSnapshot, getPlayer } from "../../src/repos/players";
import { syncPlayer } from "../../src/sync";
import { freshenBattleLog } from "../api/support";
import { FakeCrClient, FIXTURE_TAG, loadFixture, makeTestDb, makeUser, seedCards } from "../helpers";

beforeEach(() => {
  makeTestDb();
  seedCards();
});

describe("upgrade table", () => {
  test("copies per rarity", () => {
    expect(copiesForNextLevel("common", 1)).toBe(2);
    expect(copiesForNextLevel("common", 15)).toBe(7500);
    expect(copiesForNextLevel("rare", 3)).toBe(2);
    expect(copiesForNextLevel("rare", 15)).toBe(1400);
    expect(copiesForNextLevel("epic", 10)).toBe(30);
    expect(copiesForNextLevel("Legendary", 12)).toBe(9);
    expect(copiesForNextLevel("champion", 15)).toBe(15);
    expect(copiesForNextLevel("common", 16)).toBeNull();
    expect(copiesForNextLevel("rare", 2)).toBeNull();
    expect(copiesForNextLevel("mythic", 5)).toBeNull();
  });

  test("gold per step and totals", () => {
    expect(goldForNextLevel(1)).toBe(5);
    expect(goldForNextLevel(10)).toBe(15_000);
    expect(goldForNextLevel(15)).toBe(120_000);
    expect(goldForNextLevel(16)).toBeNull();
    expect(goldForNextLevel(0)).toBeNull();
    // Published total for a common from 1 to 16.
    expect(goldToMax("common", 1)).toBe(365_625);
    expect(goldToMax("legendary", 16)).toBe(0);
    expect(goldToMax("legendary", 8)).toBeNull();
    expect(goldToMax("common", 1, 17)).toBeNull();
    expect(copiesToMax("champion", 11)).toBe(41);
    expect(copiesToMax("epic", 14)).toBe(310);
    expect(copiesToMax("common", 5, 20)).toBeNull();
  });
});

describe("buildCollection", () => {
  test("without a snapshot nothing is owned", () => {
    const { summary, entries } = buildCollection(null, listCards());
    expect(summary).toMatchObject({ total: 39, owned: 0, missing: 39, upgradeReady: 0 });
    expect(entries).toHaveLength(42);
  });

  test("owned cards missing from the catalog are still listed", () => {
    const player = loadFixture<Player>("player");
    const extra = { ...player.cards[0]!, id: 26999999, name: "Brand New Card" };
    const { entries, summary } = buildCollection({ ...player, cards: [...player.cards, extra] }, listCards());
    expect(entries.find((e) => e.name === "Brand New Card")).toMatchObject({ owned: true, level: 14, maxLevel: 16 });
    expect(summary.upgradeReady).toBe(17);
    expect(summary.owned).toBe(38);
  });
});

describe("renderContextMarkdown", () => {
  test("renders every section compactly from fixtures", async () => {
    const user = makeUser();
    const client = new FakeCrClient();
    freshenBattleLog(client);
    addPlayer(user.id, FIXTURE_TAG);
    await syncPlayer(FIXTURE_TAG, client);
    const snapshot = getLatestSnapshot(FIXTURE_TAG)!;
    const deck: DeckRecord = {
      id: 1,
      userId: user.id,
      name: "Hog | cycle",
      cards: ["Hog Rider", "Musketeer", "Ice Golem", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"],
      notes: `Line one\nline two ${"x".repeat(400)}`,
      source: "ai",
      createdAt: snapshot.fetchedAt,
      updatedAt: snapshot.fetchedAt,
    };

    const md = renderContextMarkdown({
      player: getPlayer(FIXTURE_TAG)!,
      snapshot,
      stats7: getBattleStats(FIXTURE_TAG, { sinceDays: 7 }),
      stats30: getBattleStats(FIXTURE_TAG, { sinceDays: 30 }),
      recentBattles: listBattles(FIXTURE_TAG, { limit: 15 }),
      collection: buildCollection(snapshot.player, listCards()),
      notes: "## Budget\nF2P, no pass this season.",
      decks: [deck],
      appUrl: "https://cr.example.com/",
    });

    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Profile",
      "Current deck",
      "Recent performance",
      "Last battles",
      "Collection",
      "Saved decks",
      "Player notes",
      "Data limitations",
    ]);
    expect(md).toStartWith("# Clash Royale context: Sparky (#9QJUGC2R)");
    expect(md).toContain("card levels are in-game display levels");
    expect(md).toContain("App: https://cr.example.com/?tag=9QJUGC2R");
    expect(md).toContain("| The Log | 13 |");
    expect(md).toContain("- King Tower level: 15 (next level needs 14 cards at level 15+, has 3; tower troops don't count)");
    expect(md).toContain("- Collection level: 546 (");
    expect(md).toContain("- Current streak: 3 wins in a row");
    expect(md).not.toContain("Exp level");
    expect(md).toContain("| Musketeer | 14 | Evo + Hero | 4 |");
    expect(md).toContain("| Ice Golem | 14 | Hero | 2 |");
    expect(md).toContain("Tower troop: Tower Princess (level 14)");
    expect(md).toContain("- Last 7 days: 10 battles");
    expect(md).toContain("| Ranked | 3 | 2-0-1 | 67% |");
    expect(md).toMatch(/\| Ranked \| draw \| 1-1 \| Pekka Pete \|/);
    expect(md).toContain("| Trophy Road | win | 3-1 | BaitMaster |");
    expect(md).toContain("- Electro Wizard 13 → 14 (768/12 cards, 60,000 gold)");
    expect(md).toContain("| Knight | 14/16 | 102/5500 | 90,000 | Evo, Hero (not owned) |");
    expect(md).toContain("| Musketeer | 14/16 | 799/1000 | 90,000 | Evo, Hero |");
    expect(md).toContain("Gold to max: current deck 1,560,000, all owned cards 9,370,000.");
    expect(md).toContain("Card levels cap at 16. Elite Wild Cards no longer exist");
    expect(md).toContain("Missing cards: Mirror, Archer Queen");
    expect(md).toContain("Tower troops: Tower Princess 14/16, Cannoneer 12/16 (upgrade ready)");
    expect(md.match(/^- .+ → /gm)).toHaveLength(17);
    expect(md).toContain("**Hog | cycle** (ai)");
    expect(md).toContain("Notes: Line one line two");
    expect(md).not.toContain("x".repeat(301));
    expect(md).toContain("> ## Budget\n> F2P, no pass this season.");
    expect(md).toContain("Snapshot age: 0 min");
    expect(md).not.toMatch(/upcoming chests|silver chest/i);
    const battleRows = md.split("## Last battles")[1]!.split("## Collection")[0]!.split("\n").filter((l) => /^\| \d{4}-/.test(l));
    expect(md).toContain("| Opponent | Own deck | Opponent deck |");
    const hog = "Hog Rider, Musketeer, Ice Golem, Ice Spirit, Skeletons, Cannon, Fireball, The Log";
    expect(battleRows[0]).toContain(`| BaitMaster | ${hog} | Knight,`);
    // 2v2 rows list only the player's own 8 cards, not the teammate's.
    const duo = battleRows.find((r) => r.includes("Duo One & Duo Two"))!;
    expect(duo.split(" | ")[5]!.split(", ")).toHaveLength(8);
    expect(Math.max(...battleRows.filter((r) => r !== duo).map((r) => r.length))).toBeLessThan(250);
    expect(md.length).toBeLessThan(20_000);
  });

  test("snapshot time and age come from the last confirming sync", () => {
    const user = makeUser();
    const player = addPlayer(user.id, FIXTURE_TAG, "Sparky");
    const empty = getBattleStats(FIXTURE_TAG, { sinceDays: 7 });
    const now = new Date("2026-09-25T12:00:00.000Z");
    const {
      kingTowerLevel: _kt,
      collectionLevel: _cl,
      currentWinLoseStreak: _ws,
      ...beforeCollectionLevels
    } = loadFixture<Player>("player");
    const md = renderContextMarkdown({
      player,
      snapshot: {
        player: beforeCollectionLevels,
        fetchedAt: "2026-09-01T08:00:00.000Z",
        lastSeenAt: "2026-09-25T11:50:00.000Z",
      },
      stats7: empty,
      stats30: empty,
      recentBattles: [],
      collection: buildCollection(null, listCards()),
      notes: null,
      decks: [],
      now,
    });
    expect(md).toContain("snapshot: 2026-09-25 11:50 UTC (unchanged since 2026-09-01 08:00 UTC)");
    expect(md).toContain("Snapshot age: 10 min");
    expect(md).toContain("- King Tower level: unknown (snapshot predates the field)");
    expect(md).not.toContain("Collection level");
    expect(md).not.toContain("Current streak");
  });

  test("handles a player that has never synced", () => {
    const user = makeUser();
    const player = addPlayer(user.id, FIXTURE_TAG, "Sparky");
    const empty = getBattleStats(FIXTURE_TAG, { sinceDays: 7 });
    const md = renderContextMarkdown({
      player,
      snapshot: null,
      stats7: empty,
      stats30: empty,
      recentBattles: [],
      collection: buildCollection(null, listCards()),
      notes: null,
      decks: [],
    });
    expect(md).toContain("No snapshot yet");
    expect(md).toContain("Synced at: never");
    expect(md).toContain("Last battles\n\nNone stored.");
    expect(md).toContain("Snapshot age: no snapshot");
  });
});
