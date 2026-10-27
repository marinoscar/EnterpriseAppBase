// Dates and labels the sharing components show. Not exported.

import { formatDate as formatZonedDate } from '../../core/index.js';

/** A day in the viewer's display zone (`Oct 26, 2026`), or `''`. */
export function formatDate(iso: string | null | undefined): string {
  return formatZonedDate(iso, { year: 'numeric', month: 'short', day: 'numeric', fallback: '' });
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
