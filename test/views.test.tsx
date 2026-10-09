import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CardIcon, LocalTime, localTitle } from "../src/views/components";

const asset = (name: string) => readFileSync(join(import.meta.dir, "..", "public", name), "utf8");

describe("card icon fallback", () => {
  test("renders the name next to the image so a failed load can reveal it", () => {
    const html = String(<CardIcon card={{ name: "Knight", iconUrl: "https://x/knight.png", level: 14 }} />);
    expect(html).toContain('<img src="https://x/knight.png" alt="Knight" loading="lazy"/><span class="card-fallback">Knight</span>');
    const noIcon = String(<CardIcon card={{ name: "Knight" }} />);
    expect(noIcon).not.toContain("<img");
    expect(noIcon).toContain('<span class="card-fallback">Knight</span>');
  });

  test("CSS and app.js agree on the hooks they share with the markup", () => {
    const css = asset("app.css");
    const js = asset("app.js");
    expect(css).toContain(".card-icon img + .card-fallback");
    expect(css).toContain(".card-icon.img-failed .card-fallback");
    expect(js).toContain('classList.add("img-failed")');
    expect(js).toContain("button[data-retry-after]");
    expect(js).toContain("dataset.readyLabel");
  });

  test("battle rows, the dialog template, and the player menu keep the hooks app.js looks for", () => {
    const css = asset("app.css");
    const js = asset("app.js");
    expect(js).toContain('getElementById("battle-modal-template")');
    expect(js).toContain("tr.battle-row[data-href]");
    expect(js).toContain("?partial=1");
    expect(js).toContain('"details.player-menu"');
    expect(js).toContain("[data-menu-item]");
    expect(css).toContain(".battle-row.is-clickable");
    expect(css).toContain(".modal::backdrop");
  });
});

describe("local time", () => {
  const iso = "2026-09-24T10:15:30.000Z";

  test("LocalTime keeps the UTC text as the no-JS fallback and flags itself for app.js", () => {
    expect(String(<LocalTime iso={iso} />)).toBe(`<time datetime="${iso}" data-local-time="true">2026-09-24 10:15 UTC</time>`);
  });

  test("localTitle puts the UTC text in the title and the ISO time in data-local-title", () => {
    expect(String(<span {...localTitle(iso)}>x</span>)).toBe(`<span title="2026-09-24 10:15 UTC" data-local-title="${iso}">x</span>`);
  });

  test("app.js reads the same hooks the markup uses", () => {
    const js = asset("app.js");
    expect(js).toContain("time[data-local-time]");
    expect(js).toContain("[data-local-title]");
  });
});
