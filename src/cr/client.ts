import { config, requireEnv } from "../config";
import { encodeTag } from "./tag";
import type { BattleLogEntry, CardsResponse, GameEvent, Player } from "./types";

export class CrApiError extends Error {
  constructor(
    /** HTTP status, or 0 for network failures and timeouts. */
    readonly status: number,
    readonly reason: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "CrApiError";
  }
}

/** The subset of CrClient that sync code depends on, so tests can pass a fake. */
export interface CrApi {
  getPlayer(tag: string): Promise<Player>;
  getPlayerBattleLog(tag: string): Promise<BattleLogEntry[]>;
  getCards(): Promise<CardsResponse>;
  getEvents(): Promise<GameEvent[]>;
}

const TIMEOUT_MS = 15_000;

export class CrClient implements CrApi {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = "https://api.clashroyale.com/v1",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getPlayer(tag: string): Promise<Player> {
    return this.request(`/players/${encodeTag(tag)}`);
  }

  getPlayerBattleLog(tag: string): Promise<BattleLogEntry[]> {
    return this.request(`/players/${encodeTag(tag)}/battlelog`);
  }

  getCards(): Promise<CardsResponse> {
    return this.request("/cards");
  }

  // Undocumented; returns a bare array, not the usual { items } wrapper.
  getEvents(): Promise<GameEvent[]> {
    return this.request("/events");
  }

  private async request<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CrApiError(0, "network", `Clash Royale API request failed: ${msg}`);
    }
    if (res.ok) return (await res.json()) as T;

    const body = (await res.json().catch(() => null)) as { reason?: string; message?: string } | null;
    const reason = body?.reason ?? `http${res.status}`;
    const apiMsg = body?.message ?? res.statusText;
    switch (res.status) {
      case 403:
        throw new CrApiError(
          403,
          reason,
          `Clash Royale API denied access (${apiMsg}). Check CR_API_TOKEN and that the key's IP allowlist includes this server's public IP.`,
        );
      case 404:
        throw new CrApiError(404, reason, "Player not found in Clash Royale");
      case 429: {
        const retry = Number(res.headers.get("Retry-After"));
        throw new CrApiError(
          429,
          reason,
          "Clash Royale API rate limit hit",
          Number.isFinite(retry) && retry > 0 ? retry : undefined,
        );
      }
      case 503:
        throw new CrApiError(503, reason, "Clash Royale API is under maintenance");
      default:
        throw new CrApiError(res.status, reason, `Clash Royale API error ${res.status}: ${apiMsg}`);
    }
  }
}

let shared: CrApi | null = null;

/** Process-wide client built from config. Throws if CR_API_TOKEN is unset. */
export function getCrClient(): CrApi {
  shared ??= new CrClient(requireEnv("CR_API_TOKEN"), config.CR_API_BASE);
  return shared;
}

/** Routes call getCrClient() themselves, so HTTP tests swap in a fake here. Pass null to reset. */
export function setCrClientForTests(client: CrApi | null): void {
  shared = client;
}
