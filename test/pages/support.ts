import type { Hono } from "hono";
import { createApp } from "../../src/app";
import { createSession, SESSION_COOKIE } from "../../src/auth/sessions";
import { config } from "../../src/config";
import { setCrClientForTests } from "../../src/cr/client";
import { addPlayer } from "../../src/repos/players";
import { syncPlayer } from "../../src/sync";
import type { AppEnv, User } from "../../src/types";
import { FakeCrClient, FIXTURE_TAG, makeTestDb, seedCards } from "../helpers";

export interface PageTestEnv {
  app: Hono<AppEnv>;
  client: FakeCrClient;
}

/** Fixture battles have fixed dates; shift them so the newest is an hour old and 7/30-day windows include them. */
function freshen(client: FakeCrClient): void {
  const parse = (s: string) => Date.parse(s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6"));
  const times = client.battleLog.map((b) => parse(b.battleTime));
  const shift = Date.now() - 3_600_000 - Math.max(...times);
  client.battleLog = client.battleLog.map((b, i) => ({
    ...b,
    battleTime: new Date(times[i]! + shift).toISOString().replace(/[-:]/g, ""),
  }));
}

export function setupPages(): PageTestEnv {
  makeTestDb();
  seedCards();
  config.SYNC_COOLDOWN_SECONDS = 300;
  const client = new FakeCrClient();
  freshen(client);
  setCrClientForTests(client);
  return { app: createApp(), client };
}

export const cookieFor = (u: User): string => `${SESSION_COOKIE}=${createSession(u.id)}`;

/** Browser-like form POST: same-origin Origin header so the csrf check passes. */
export function formPost(cookie: string | null, fields: Record<string, string | string[]>): RequestInit {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const item of [v].flat()) body.append(k, item);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: "http://localhost",
  };
  if (cookie) headers.Cookie = cookie;
  return { method: "POST", headers, body: body.toString() };
}

/** "name=value" pairs from Set-Cookie headers, ready to send back. */
export function responseCookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");
}

/** Follows one PRG redirect, carrying the session plus any cookies the POST set (flash etc.). */
export async function follow(app: Hono<AppEnv>, res: Response, cookie: string): Promise<Response> {
  const location = res.headers.get("location");
  if (!location) throw new Error(`expected a redirect, got ${res.status}`);
  const set = responseCookies(res);
  return app.request(location, { headers: { Cookie: set ? `${cookie}; ${set}` : cookie } });
}

export async function linkFixturePlayer(u: User, client: FakeCrClient): Promise<void> {
  addPlayer(u.id, FIXTURE_TAG);
  await syncPlayer(FIXTURE_TAG, client);
}
