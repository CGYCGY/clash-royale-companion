import { createHash, randomBytes } from "node:crypto";

export const sha256Hex = (input: string): string => createHash("sha256").update(input).digest("hex");

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/** Uniform random string from `alphabet`. Alphabet length must divide 256 to avoid modulo bias. */
export function randomString(length: number, alphabet: string): string {
  if (256 % alphabet.length !== 0) throw new Error("alphabet length must divide 256");
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
