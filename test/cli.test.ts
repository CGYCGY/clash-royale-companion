import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "cr-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function cli(...args: string[]): { code: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync([process.execPath, "src/cli/index.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, DATABASE_PATH: join(dir, "cli.db") },
  });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const expiryDays = (stderr: string): number | null => {
  const m = /expires: (\S+)/.exec(stderr);
  if (!m || m[1] === "never") return null;
  return Math.round((Date.parse(m[1]!) - Date.now()) / 86_400_000);
};

describe("cli invite create", () => {
  test("defaults to a 7-day expiry like the admin API", () => {
    const r = cli("invite", "create");
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^[A-Z0-9]{12}$/);
    expect(expiryDays(r.stderr)).toBe(7);
  });

  test("--days overrides; --days 0 and --no-expiry never expire", () => {
    expect(expiryDays(cli("invite", "create", "--days", "30").stderr)).toBe(30);
    expect(cli("invite", "create", "--days", "0").stderr).toContain("expires: never");
    expect(cli("invite", "create", "--no-expiry").stderr).toContain("expires: never");
    expect(cli("invite", "create", "--days", "-1").code).toBe(1);
  });
});
