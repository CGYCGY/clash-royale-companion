import { describe, expect, test } from "bun:test";
import { battleModeLabel, humanizeMode } from "../../src/domain/battleModes";

const titles = new Map([
  ["#2C9J8QUU", "Royale Shuffle"],
  ["#2C9JGJ2J", "Classic 2v2"],
]);
const label = (type: string, gameModeName: string, eventTag: string | null = null) =>
  battleModeLabel({ type, gameModeName, eventTag }, titles);

describe("battleModeLabel", () => {
  test("an event title wins over every fallback", () => {
    expect(label("unknown", "RR_Heist_Friendly", "#2C9J8QUU")).toBe("Royale Shuffle");
    expect(label("trail", "TeamVsTeam", "#2C9JGJ2J")).toBe("Classic 2v2");
  });

  test("known types and modes map to what the game calls them", () => {
    expect(label("pathOfLegend", "Ranked1v1_NewArena2")).toBe("Ranked");
    expect(label("PvP", "Ladder")).toBe("Trophy Road");
    expect(label("riverRacePvP", "RampUpElixir_Ladder")).toBe("Clan War");
    expect(label("riverRaceDuel", "CW_Duel_1v1")).toBe("Clan War");
    expect(label("boatBattle", "ClanWar_BoatBattle")).toBe("Clan War");
    // An ended event's tag no longer resolves.
    expect(label("trail", "TeamVsTeam", "#2C9J990U")).toBe("2v2");
    expect(label("clanMate2v2", "TeamVsTeam")).toBe("2v2");
    expect(label("friendly", "Friendly")).toBe("Friendly");
  });

  test("anything else is the raw mode id, humanized", () => {
    expect(label("unknown", "RR_CaptureTheEgg_Friendly", "#GONE")).toBe("Capture The Egg");
    expect(label("trail", "All_Random_Princess_Friendly")).toBe("All Random Princess");
    expect(label("PvP", "Touchdown_Draft")).toBe("Touchdown Draft");
    expect(label("somethingNew", "")).toBe("Something New");
  });
});

describe("humanizeMode", () => {
  test("drops internal prefixes and suffixes and splits words", () => {
    expect(humanizeMode("RR_Snowball_bombardment")).toBe("Snowball Bombardment");
    expect(humanizeMode("RR_Event_Mega_Monk")).toBe("Mega Monk");
    expect(humanizeMode("RampUpElixir_Ladder")).toBe("Ramp Up Elixir Ladder");
    expect(humanizeMode("Friendly")).toBe("Friendly");
  });
});
