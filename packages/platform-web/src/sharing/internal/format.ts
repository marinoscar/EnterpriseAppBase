// Dates and labels the sharing components show. Not exported.

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function expiryText(iso: string | null | undefined): string {
  return iso ? `Expires ${formatDate(iso)}` : 'Never expires';
}

/** `media_item` becomes `Media item`. */
export function humanizeType(type: string): string {
  const words = type.replace(/_/g, ' ').trim();
  return words.length === 0 ? type : words.charAt(0).toUpperCase() + words.slice(1);
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `days` from now as an ISO instant, or `null` for never. */
export function expiryFromDays(days: number | null, now: Date = new Date()): string | null {
  if (days === null) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
