import { describe, expect, test } from "bun:test";
import { battleMode, battleModeLabel, humanizeMode, modeMatches } from "../../src/domain/battleModes";

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

describe("clan war sub-modes", () => {
  const mode = (type: string, gameModeName: string) => battleMode({ type, gameModeName, eventTag: null }, titles);

  test("each war battle kind gets its own label and a tag beside Clan War", () => {
    expect(mode("riverRacePvP", "CW_Battle_1v1")).toEqual({ label: "Clan War · Battle", tags: ["Clan War", "Battle"] });
    expect(mode("riverRacePvP", "Touchdown_ClanWar")).toEqual({
      label: "Clan War · Touchdown",
      tags: ["Clan War", "Touchdown"],
    });
    expect(mode("riverRacePvP", "RampUpElixir_Ladder").tags).toEqual(["Clan War", "Ramp Up Elixir"]);
    expect(mode("riverRaceDuel", "CW_Duel_1v1").label).toBe("Clan War · Duel");
    expect(mode("riverRaceDuelColosseum", "CW_Duel_1v1").label).toBe("Clan War · Colosseum Duel");
    expect(mode("boatBattle", "ClanWar_BoatBattle").tags).toEqual(["Clan War", "Boat Battle"]);
    expect(mode("clanWarWarDay", "ClanWar")).toEqual({ label: "Clan War · Battle", tags: ["Clan War", "Battle"] });
  });

  test("a filter matches the exact label or any tag", () => {
    const td = mode("riverRacePvP", "Touchdown_ClanWar");
    expect(["Clan War", "Touchdown", "Clan War · Touchdown"].every((f) => modeMatches(td, f))).toBe(true);
    expect(modeMatches(td, "Clan War · Battle")).toBe(false);
    expect(modeMatches(mode("PvP", "Ladder"), "Trophy Road")).toBe(true);
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
