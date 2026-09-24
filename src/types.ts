import type { PlayerContext } from "./http/currentPlayer";

export interface User {
  id: number;
  username: string;
  createdAt: string;
}

export type AuthMethod = "session" | "apikey" | null;

export interface Flash {
  type: "info" | "success" | "error";
  message: string;
  /** Set when the page shows the message next to the form it concerns instead of at the top. */
  target?: string;
}

export interface Variables {
  user: User | null;
  authMethod: AuthMethod;
  flash: Flash | null;
  /** Per-request cache for src/http/currentPlayer.ts; unset until first asked for. */
  playerContext: PlayerContext | undefined;
}

export type AppEnv = { Variables: Variables };
