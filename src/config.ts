import { z } from "zod";

const envSchema = z.object({
  CR_API_TOKEN: z.string().optional(),
  CR_API_BASE: z.url().default("https://api.clashroyale.com/v1"),
  DATABASE_PATH: z.string().default("./data/app.db"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SYNC_CRON: z.string().default("0 3 * * *"),
  SYNC_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
  APP_URL: z.url().optional(),
  SNAPSHOT_KEEP_ALL_DAYS: z.coerce.number().int().min(0).default(7),
  SNAPSHOT_KEEP_DAILY_DAYS: z.coerce.number().int().min(0).default(90),
});

export type Config = z.infer<typeof envSchema>;
export type RequiredEnvKey = "CR_API_TOKEN";

export function loadConfig(env: Record<string, string | undefined>): Config {
  // `KEY=` in a .env file yields "", which should mean "unset" rather than fail validation.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

// Mutable on purpose: tests override individual fields (e.g. SYNC_COOLDOWN_SECONDS).
export const config: Config = loadConfig(process.env);

export function requireEnv(key: RequiredEnvKey): string {
  const value = config[key];
  if (!value) {
    throw new Error(`Missing required environment variable ${key}. See .env.example.`);
  }
  return value;
}

export const isSecureCookie = (): boolean => config.APP_URL?.startsWith("https://") ?? false;
