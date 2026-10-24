// The fallback "3 minutes ago" formatter, used when the host supplies no
// `formatRelativeTime`. Same rules as the reference app's
// `utils/relativeTime.ts`: Intl.RelativeTimeFormat, "Just now" under 45 s (a
// clock-skew guard), the ISO string on an unparseable input. Not exported.

const UNITS: { limit: number; ms: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 60_000, ms: 1_000, unit: 'second' },
  { limit: 3_600_000, ms: 60_000, unit: 'minute' },
  { limit: 86_400_000, ms: 3_600_000, unit: 'hour' },
  { limit: 604_800_000, ms: 86_400_000, unit: 'day' },
  { limit: 2_629_800_000, ms: 604_800_000, unit: 'week' },
  { limit: 31_557_600_000, ms: 2_629_800_000, unit: 'month' },
  { limit: Infinity, ms: 31_557_600_000, unit: 'year' },
];

const JUST_NOW_MS = 45_000;

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;

  const elapsed = now.getTime() - time;
  if (elapsed < JUST_NOW_MS) return 'Just now';

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const { limit, ms, unit } of UNITS) {
    if (elapsed < limit) return formatter.format(-Math.floor(elapsed / ms), unit);
  }
  return iso;
}
