import { Hono } from "hono";
import pkg from "../../../package.json";
import { getDb } from "../../db";
import type { AppEnv } from "../../types";

export const healthRoutes = new Hono<AppEnv>().get("/health", (c) => {
  let dbOk = false;
  try {
    dbOk = getDb().query("SELECT 1 AS ok").get() !== null;
  } catch {
    dbOk = false;
  }
  return c.json({ ok: dbOk, version: pkg.version, dbOk }, dbOk ? 200 : 503);
});
