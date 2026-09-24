import { describe, expect, test } from "bun:test";
import { CrApiError, CrClient } from "../src/cr/client";
import { displayLevel } from "../src/cr/levels";
import { encodeTag, isValidTag, normalizeTag, tagSlug } from "../src/cr/tag";
import { parseBattleTime } from "../src/cr/types";

describe("normalizeTag", () => {
  test("uppercases, trims, and adds #", () => {
    expect(normalizeTag("  9qjugc2r ")).toBe("#9QJUGC2R");
    expect(normalizeTag("#9QJUGC2R")).toBe("#9QJUGC2R");
  });
  test("maps letter O to zero", () => {
    expect(normalizeTag("#8lq2rOycp")).toBe("#8LQ2R0YCP");
  });
  test("collapses repeated #", () => {
    expect(normalizeTag("##PYVJ98G2")).toBe("#PYVJ98G2");
  });
  test("rejects invalid characters and lengths", () => {
    expect(() => normalizeTag("#ABCDEF")).toThrow(/Invalid player tag/);
    expect(() => normalizeTag("#12")).toThrow();
    expect(() => normalizeTag("")).toThrow();
    expect(isValidTag("#9QJ-UGC")).toBe(false);
    expect(isValidTag("2PP")).toBe(true);
  });
  test("slug and URL encoding", () => {
    expect(tagSlug("#9QJUGC2R")).toBe("9QJUGC2R");
    expect(encodeTag("#9QJUGC2R")).toBe("%239QJUGC2R");
  });
});

describe("parseBattleTime", () => {
  test("converts compact API format to ISO", () => {
    expect(parseBattleTime("20240101T120000.000Z")).toBe("2024-01-01T12:00:00.000Z");
    expect(parseBattleTime("20260924T101530.250Z")).toBe("2026-09-24T10:15:30.250Z");
  });
  test("accepts missing milliseconds", () => {
    expect(parseBattleTime("20240229T235959Z")).toBe("2024-02-29T23:59:59.000Z");
  });
  test("rejects garbage", () => {
    expect(() => parseBattleTime("2024-01-01T12:00:00Z")).toThrow();
    expect(() => parseBattleTime("nope")).toThrow();
  });
});

describe("displayLevel", () => {
  test("offsets by rarity", () => {
    expect(displayLevel(14, "common")).toBe(14);
    expect(displayLevel(12, "rare")).toBe(14);
    expect(displayLevel(6, "epic")).toBe(11);
    expect(displayLevel(1, "legendary")).toBe(9);
    expect(displayLevel(1, "champion")).toBe(11);
    expect(displayLevel(5, undefined)).toBe(5);
  });
});

describe("CrClient", () => {
  const last = { url: "", auth: null as string | null };
  const fakeFetch = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      last.url = String(url);
      last.auth = new Headers(init?.headers).get("Authorization");
      return new Response(JSON.stringify(body), { status, headers });
    }) as unknown as typeof fetch;

  test("encodes tag and sends bearer token", async () => {
    const client = new CrClient("tok", "https://example.test/v1/", fakeFetch(200, { name: "x" }));
    await client.getPlayer("#9QJUGC2R");
    expect(last.url).toBe("https://example.test/v1/players/%239QJUGC2R");
    expect(last.auth).toBe("Bearer tok");
  });

  test("403 mentions the IP allowlist", async () => {
    const client = new CrClient("tok", undefined, fakeFetch(403, { reason: "accessDenied.invalidIp", message: "bad ip" }));
    const err = await client.getCards().catch((e) => e);
    expect(err).toBeInstanceOf(CrApiError);
    expect(err.status).toBe(403);
    expect(err.reason).toBe("accessDenied.invalidIp");
    expect(err.message).toContain("allowlist");
  });

  test("404 and 429 with Retry-After", async () => {
    const notFound = await new CrClient("t", undefined, fakeFetch(404, { reason: "notFound" }))
      .getPlayer("#2PP")
      .catch((e) => e);
    expect(notFound.status).toBe(404);
    const limited = await new CrClient("t", undefined, fakeFetch(429, { reason: "requestThrottled" }, { "Retry-After": "7" }))
      .getPlayer("#2PP")
      .catch((e) => e);
    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBe(7);
  });

  test("network failure becomes status 0", async () => {
    const boom = (async () => {
      throw new TypeError("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const err = await new CrClient("t", undefined, boom).getCards().catch((e) => e);
    expect(err).toBeInstanceOf(CrApiError);
    expect(err.status).toBe(0);
  });
});
