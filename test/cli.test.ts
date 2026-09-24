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

describe("cli admin-token", () => {
  test("create prints the raw token once; list and revoke", () => {
    const created = cli("admin-token", "create", "--name", "laptop");
    expect(created.code).toBe(0);
    const raw = created.stdout.trim();
    expect(raw).toMatch(/^cra_[\w-]{43}$/);
    expect(created.stderr).toContain("cannot be shown again");
    const id = /\(id (\d+)\)/.exec(created.stderr)![1]!;

    const listed = cli("admin-token", "list");
    expect(listed.stdout).toContain("laptop");
    expect(listed.stdout).toContain(raw.slice(0, 8));
    expect(listed.stdout).not.toContain(raw);

    expect(cli("admin-token", "revoke", id).stdout).toContain("Revoked.");
    expect(cli("admin-token", "revoke", id).stdout).toContain("No active admin token");
    expect(cli("admin-token", "revoke").code).toBe(1);
  });
});
