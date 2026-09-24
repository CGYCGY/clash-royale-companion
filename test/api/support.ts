import type { Hono } from "hono";
import { createApp } from "../../src/app";
import { createAdminToken } from "../../src/auth/adminTokens";
import { createApiKey } from "../../src/auth/apiKeys";
import { createSession, SESSION_COOKIE } from "../../src/auth/sessions";
import { config } from "../../src/config";
import { setCrClientForTests } from "../../src/cr/client";
import { addPlayer } from "../../src/repos/players";
import { syncPlayer } from "../../src/sync";
import type { AppEnv, User } from "../../src/types";
import { FakeCrClient, FIXTURE_TAG, makeTestDb, seedCards } from "../helpers";

const toCompact = (iso: string): string => iso.replace(/[-:]/g, "");

/**
 * The fixture battle log has fixed timestamps; shift it so the newest battle is an hour old and
 * day-window stats keep working no matter when the suite runs.
 */
export function freshenBattleLog(client: FakeCrClient, now = Date.now()): void {
  const times = client.battleLog.map((b) => Date.parse(b.battleTime.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6")));
  const shift = now - 3_600_000 - Math.max(...times);
  client.battleLog = client.battleLog.map((b, i) => ({
    ...b,
    battleTime: toCompact(new Date(times[i]! + shift).toISOString()),
  }));
}

export interface ApiTestEnv {
  app: Hono<AppEnv>;
  client: FakeCrClient;
}

/** Fresh DB + catalog, fake CR client installed for routes, default config for tests. */
export function setupApi(): ApiTestEnv {
  makeTestDb();
  seedCards();
  config.SYNC_COOLDOWN_SECONDS = 300;
  const client = new FakeCrClient();
  freshenBattleLog(client);
  setCrClientForTests(client);
  return { app: createApp(), client };
}

/** Includes Origin like a browser would; hono's csrf check rejects bodyless cookie DELETEs without it. */
export const sessionHeaders = (u: User): Record<string, string> => ({
  Cookie: `${SESSION_COOKIE}=${createSession(u.id)}`,
  Origin: "http://localhost",
});

export const adminHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${createAdminToken("test").raw}`,
});

export const apiKeyHeaders = (u: User): Record<string, string> => ({
  Authorization: `Bearer ${createApiKey(u.id, "test").raw}`,
});

/** Tracks the fixture player for `u` and runs one sync (snapshot + 10 battles). */
export async function linkFixturePlayer(u: User, client: FakeCrClient): Promise<void> {
  addPlayer(u.id, FIXTURE_TAG);
  await syncPlayer(FIXTURE_TAG, client);
}

export function jsonInit(method: string, headers: Record<string, string>, body?: unknown): RequestInit {
  return {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export interface ErrorJson {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
