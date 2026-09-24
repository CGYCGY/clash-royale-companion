import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CardIcon } from "../src/views/components";

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
    expect(js).toContain('"tr.battle-row[data-href]"');
    expect(js).toContain('"a.row-link"');
    expect(js).toContain("?partial=1");
    expect(js).toContain('"details.player-menu"');
    expect(js).toContain("[data-menu-item]");
    expect(css).toContain(".battle-row.is-clickable");
    expect(css).toContain(".modal::backdrop");
  });
});
