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
});
