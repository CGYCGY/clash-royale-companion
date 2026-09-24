export const formatPercent = (ratio: number, digits = 0): string => `${(ratio * 100).toFixed(digits)}%`;

/** "2026-09-24 10:15 UTC" */
export const formatDateTime = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.round(seconds / 86400)}d ago`;
  return iso.slice(0, 10);
}

export const formatSigned = (n: number): string => (n > 0 ? `+${n}` : String(n));
