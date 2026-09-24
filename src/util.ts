export const nowIso = (now: Date = new Date()): string => now.toISOString();

export const daysAgoIso = (days: number, now: Date = new Date()): string =>
  new Date(now.getTime() - days * 86_400_000).toISOString();

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const ratio = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 1000) / 1000;
