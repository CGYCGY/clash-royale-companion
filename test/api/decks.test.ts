import { beforeEach, describe, expect, test } from "bun:test";
import { CrApiError } from "../../src/cr/client";
import type { CardRecord } from "../../src/repos/cards";
import type { DeckRecord } from "../../src/repos/decks";
import type { User } from "../../src/types";
import { FIXTURE_TAG, makeUser } from "../helpers";
import {
  type ApiTestEnv,
  apiKeyHeaders,
  type ErrorJson,
  jsonInit,
  linkFixturePlayer,
  sessionHeaders,
  setupApi,
} from "./support";

type DeckJson = DeckRecord & {
  avgElixir: number | null;
  cardDetails: { name: string; elixirCost: number | null; rarity: string | null; iconUrl: string | null }[];
};

const HOG = ["hog rider", "Musketeer", "Ice Golem", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"];

let env: ApiTestEnv;
let alice: User;
let session: Record<string, string>;
let apiKey: Record<string, string>;

beforeEach(() => {
  env = setupApi();
  alice = makeUser("alice");
  session = sessionHeaders(alice);
  apiKey = apiKeyHeaders(alice);
});

async function create(headers: Record<string, string>, body: Record<string, unknown>): Promise<DeckJson> {
  const res = await env.app.request("/api/decks", jsonInit("POST", headers, body));
  expect(res.status).toBe(201);
  return ((await res.json()) as { deck: DeckJson }).deck;
}

describe("decks CRUD", () => {
  test("create, read, list, patch, delete", async () => {
    const deck = await create(session, { name: "Hog 2.6", cards: HOG, notes: "Cycle" });
    expect(deck.cards[0]).toBe("Hog Rider");
    expect(deck.avgElixir).toBe(2.63);
    expect(deck.cardDetails[0]).toMatchObject({ name: "Hog Rider", elixirCost: 4, rarity: "rare" });
    expect(deck.cardDetails[0]!.iconUrl).toStartWith("https://");

    const one = await env.app.request(`/api/decks/${deck.id}`, { headers: session });
    expect(((await one.json()) as { deck: DeckJson }).deck.name).toBe("Hog 2.6");

    const list = (await (await env.app.request("/api/decks", { headers: session })).json()) as { decks: DeckJson[] };
    expect(list.decks.map((d) => d.id)).toEqual([deck.id]);
    expect(list.decks[0]!.avgElixir).toBe(2.63);

    const patched = await env.app.request(`/api/decks/${deck.id}`, jsonInit("PATCH", session, { name: "Hog cycle" }));
    expect(patched.status).toBe(200);
    const body = ((await patched.json()) as { deck: DeckJson }).deck;
    expect(body).toMatchObject({ name: "Hog cycle", notes: "Cycle", cards: deck.cards });

    const empty = await env.app.request(`/api/decks/${deck.id}`, jsonInit("PATCH", session, {}));
    expect(empty.status).toBe(400);

    expect((await env.app.request(`/api/decks/${deck.id}`, { method: "DELETE", headers: session })).status).toBe(204);
    expect((await env.app.request(`/api/decks/${deck.id}`, { headers: session })).status).toBe(404);
    expect((await env.app.request(`/api/decks/${deck.id}`, { method: "DELETE", headers: session })).status).toBe(404);
  });

  test("invalid decks are 400 invalid_deck with details", async () => {
    const res = await env.app.request(
      "/api/decks",
      jsonInit("POST", session, { name: "Bad", cards: [...HOG.slice(0, 6), "Hog Rider", "Not A Card"] }),
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as ErrorJson;
    expect(error.code).toBe("invalid_deck");
    expect(error.details).toEqual({ unknown: ["Not A Card"], duplicates: ["Hog Rider"], count: 8 });

    const short = await env.app.request("/api/decks", jsonInit("POST", session, { name: "Short", cards: HOG.slice(0, 7) }));
    expect(((await short.json()) as ErrorJson).error.code).toBe("invalid_deck");

    const deck = await create(session, { name: "Ok", cards: HOG });
    const badPatch = await env.app.request(`/api/decks/${deck.id}`, jsonInit("PATCH", session, { cards: ["Knight"] }));
    expect(badPatch.status).toBe(400);
    expect(((await badPatch.json()) as ErrorJson).error.code).toBe("invalid_deck");

    const noName = await env.app.request("/api/decks", jsonInit("POST", session, { name: "", cards: HOG }));
    expect(((await noName.json()) as ErrorJson).error.code).toBe("validation_error");
  });

  test("source defaults to ai for API keys and manual for sessions", async () => {
    expect((await create(apiKey, { name: "From AI", cards: HOG })).source).toBe("ai");
    expect((await create(session, { name: "By hand", cards: HOG })).source).toBe("manual");
    expect((await create(apiKey, { name: "Explicit", cards: HOG, source: "manual" })).source).toBe("manual");
  });

  test("decks are private to their owner", async () => {
    const deck = await create(session, { name: "Mine", cards: HOG });
    const bob = apiKeyHeaders(makeUser("bob"));
    expect((await env.app.request(`/api/decks/${deck.id}`, { headers: bob })).status).toBe(404);
    expect((await env.app.request(`/api/decks/${deck.id}`, jsonInit("PATCH", bob, { name: "x" }))).status).toBe(404);
    expect((await env.app.request(`/api/decks/${deck.id}`, { method: "DELETE", headers: bob })).status).toBe(404);
    const list = (await (await env.app.request("/api/decks", { headers: bob })).json()) as { decks: unknown[] };
    expect(list.decks).toEqual([]);
  });
});

describe("deck check", () => {
  test("reports levels against the player's collection", async () => {
    await linkFixturePlayer(alice, env.client);
    const deck = await create(session, {
      name: "Queen",
      cards: ["Archer Queen", "Hog Rider", "Musketeer", "Ice Golem", "Ice Spirit", "Skeletons", "Cannon", "The Log"],
    });
    const res = await env.app.request(`/api/decks/${deck.id}/check?tag=${encodeURIComponent(FIXTURE_TAG)}`, {
      headers: session,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cards: { name: string; level: number | null; maxLevel: number; owned: boolean; evolutionLevel: number }[];
      avgElixir: number | null;
      missing: string[];
      fetchedAt: string | null;
      lastSeenAt: string | null;
    };
    expect(body.missing).toEqual(["Archer Queen"]);
    expect(body.cards[0]).toEqual({ name: "Archer Queen", level: null, maxLevel: 16, owned: false, evolutionLevel: 0 });
    expect(body.cards.find((c) => c.name === "The Log")).toMatchObject({ level: 13, owned: true });
    expect(body.avgElixir).toBe(2.75);
    expect(body.fetchedAt).toBeString();
    expect(body.lastSeenAt).toBeString();
  });

  test("without a snapshot, ownership is unknown rather than missing", async () => {
    env.client.fail.getPlayer = new CrApiError(503, "maintenance", "down");
    await linkFixturePlayer(alice, env.client);
    const deck = await create(session, { name: "Mine", cards: HOG });
    const res = await env.app.request(`/api/decks/${deck.id}/check?tag=9QJUGC2R`, { headers: session });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fetchedAt: string | null;
      cards: { owned: boolean | null; level: number | null; maxLevel: number | null }[];
      missing: string[];
      note?: string;
    };
    expect(body).toMatchObject({ fetchedAt: null, lastSeenAt: null, missing: [], note: "no snapshot yet" });
    expect(body.cards).toHaveLength(8);
    expect(body.cards.every((c) => c.owned === null && c.level === null && c.maxLevel === 16)).toBe(true);
  });

  test("the player must belong to the user", async () => {
    const bob = makeUser("bob");
    await linkFixturePlayer(bob, env.client);
    const deck = await create(session, { name: "Mine", cards: HOG });
    const res = await env.app.request(`/api/decks/${deck.id}/check?tag=9QJUGC2R`, { headers: session });
    expect(res.status).toBe(404);
    const noTag = await env.app.request(`/api/decks/${deck.id}/check`, { headers: session });
    expect(noTag.status).toBe(400);
  });
});

describe("cards catalog", () => {
  test("lists cards, optionally by kind", async () => {
    const all = (await (await env.app.request("/api/cards", { headers: apiKey })).json()) as { cards: CardRecord[] };
    expect(all.cards).toHaveLength(42);
    const towers = (await (await env.app.request("/api/cards?kind=support", { headers: apiKey })).json()) as {
      cards: CardRecord[];
    };
    expect(towers.cards.map((c) => c.name).sort()).toEqual(["Cannoneer", "Dagger Duchess", "Tower Princess"]);
    expect((await env.app.request("/api/cards?kind=spell", { headers: apiKey })).status).toBe(400);
  });
});
