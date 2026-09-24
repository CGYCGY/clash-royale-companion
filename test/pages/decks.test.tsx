import { beforeEach, describe, expect, test } from "bun:test";
import { listDecks } from "../../src/repos/decks";
import type { User } from "../../src/types";
import { makeUser } from "../helpers";
import { cookieFor, follow, formPost, linkFixturePlayer, type PageTestEnv, setupPages } from "./support";

let env: PageTestEnv;
let user: User;
let cookie: string;
beforeEach(() => {
  env = setupPages();
  user = makeUser();
  cookie = cookieFor(user);
});

const HOG = ["hog rider", "Musketeer", "Valkyrie", "Ice Spirit", "Skeletons", "Cannon", "Fireball", "The Log"];

describe("deck pages", () => {
  test("create, view with level check, edit, and delete", async () => {
    await linkFixturePlayer(user, env.client);
    const created = await env.app.request("/decks", formPost(cookie, { name: "Hog 2.6", cards: HOG, notes: "Cycle fast.\n\n<b>Not bold</b>" }));
    expect(created.status).toBe(302);
    const [deck] = listDecks(user.id);
    expect(deck?.cards[0]).toBe("Hog Rider");
    expect(deck?.source).toBe("manual");
    expect(created.headers.get("location")).toBe(`/decks/${deck!.id}`);

    const detail = await (await follow(env.app, created, cookie)).text();
    expect(detail).toContain('Saved &quot;Hog 2.6&quot;.');
    expect(detail).toContain("<p>Cycle fast.</p>");
    expect(detail).toContain("&lt;b&gt;Not bold&lt;/b&gt;");
    expect(detail).toContain("Level check");
    expect(detail).toContain("Sparky");

    const list = await (await env.app.request("/decks", { headers: { Cookie: cookie } })).text();
    expect(list).toContain("Hog 2.6");
    expect(list).toContain(`/decks/${deck!.id}/edit`);

    const edit = await env.app.request(`/decks/${deck!.id}/edit`, { headers: { Cookie: cookie } });
    expect(await edit.text()).toContain('value="Hog Rider"');
    const updated = await env.app.request(`/decks/${deck!.id}`, formPost(cookie, { name: "Hog cycle", cards: HOG, notes: "" }));
    expect(updated.status).toBe(302);
    expect(listDecks(user.id)[0]?.name).toBe("Hog cycle");

    const del = await env.app.request(`/decks/${deck!.id}/delete`, formPost(cookie, {}));
    expect(del.headers.get("location")).toBe("/decks");
    expect(listDecks(user.id)).toHaveLength(0);
  });

  test("invalid decks re-render with unknown and duplicate cards listed", async () => {
    const res = await env.app.request(
      "/decks",
      formPost(cookie, { name: "Bad", cards: ["Hog Rider", "Hog Rider", "Not A Card", "Zap", "Arrows", "Miner", "Tesla", "Knight"] }),
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Unknown cards: Not A Card");
    expect(html).toContain("Duplicates: Hog Rider");
    expect(html).toContain('value="Not A Card"');
    expect(listDecks(user.id)).toHaveLength(0);

    const short = await env.app.request("/decks", formPost(cookie, { name: "Short", cards: ["Zap", "", ""] }));
    expect(short.status).toBe(400);
    expect(await short.text()).toContain("exactly 8 cards (got 1)");

    const noName = await env.app.request("/decks", formPost(cookie, { name: " ", cards: HOG }));
    expect(noName.status).toBe(400);
    expect(await noName.text()).toContain("Give the deck a name");
  });

  test("other users' decks are 404", async () => {
    await env.app.request("/decks", formPost(cookie, { name: "Mine", cards: HOG }));
    const [deck] = listDecks(user.id);
    const mallory = cookieFor(makeUser("mallory"));
    expect((await env.app.request(`/decks/${deck!.id}`, { headers: { Cookie: mallory } })).status).toBe(404);
    expect((await env.app.request(`/decks/${deck!.id}/delete`, formPost(mallory, {}))).status).toBe(404);
    expect(listDecks(user.id)).toHaveLength(1);
  });
});
