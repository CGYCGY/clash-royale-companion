export interface User {
  id: number;
  username: string;
  createdAt: string;
}

export type AuthMethod = "session" | "apikey" | null;

export interface Flash {
  type: "info" | "success" | "error";
  message: string;
}

export interface Variables {
  user: User | null;
  authMethod: AuthMethod;
  flash: Flash | null;
}

export type AppEnv = { Variables: Variables };
