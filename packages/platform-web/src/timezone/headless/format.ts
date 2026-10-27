// Date and time formatting in the display zone. Every formatter defaults
// `timeZone` to `getDisplayTimeZone()`; a caller passes an explicit
// `timeZone` (often `'UTC'`) for a server fact that is defined in one zone.

import { getDisplayTimeZone } from './store.js';

/**
 * A value a formatter accepts: a `Date`, an ISO 8601 string or epoch
 * milliseconds. `null`, `undefined`, `''` and an unparsable value render the
 * fallback.
 *
 * @stability experimental
 */
export type DateInput = Date | string | number | null | undefined;

/**
 * Options of {@link formatDateTime}, {@link formatDate} and {@link formatTime}:
 * every `Intl.DateTimeFormatOptions` field, plus the locale and what an empty
 * value renders. `timeZone` defaults to the display zone.
 *
 * @stability experimental
 */
export interface TimeZoneFormatOptions extends Intl.DateTimeFormatOptions {
  /** The BCP 47 locale(s); default: the runtime's. */
  locale?: string | readonly string[];
  /** What an empty or invalid value renders. Default `'—'`. */
  fallback?: string;
}

/** What an empty or invalid date renders across the packaged pages. */
const DEFAULT_FALLBACK = '—';
const CACHE_LIMIT = 200;
const cache = new Map<string, Intl.DateTimeFormat>();

/** Options that pick date or time fields one by one (they cannot mix with `dateStyle`/`timeStyle`). */
const FIELD_KEYS = [
  'dateStyle',
  'timeStyle',
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'dayPeriod',
  'hour',
  'minute',
  'second',
  'fractionalSecondDigits',
  'timeZoneName',
] as const;

/**
 * The value as a valid `Date`, or `null`.
 *
 * @param value - see {@link DateInput}.
 * @returns the date, or `null` for an empty or invalid value.
 *
 * @stability experimental
 */
export function toValidDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cachedFormatter(locale: string | readonly string[] | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify([locale ?? null, Object.entries(options).sort(([a], [b]) => a.localeCompare(b))]);
  let formatter = cache.get(key);
  if (!formatter) {
    if (cache.size >= CACHE_LIMIT) cache.clear();
    formatter = new Intl.DateTimeFormat(locale as string | string[] | undefined, options);
    cache.set(key, formatter);
  }
  return formatter;
}

/**
 * A cached `Intl.DateTimeFormat` for the options, in the display zone unless
 * `options.timeZone` says otherwise. An unknown zone falls back to UTC.
 *
 * @param options - format options; `locale` picks the locale.
 * @returns the formatter.
 *
 * @stability experimental
 */
export function getDateTimeFormat(options: Omit<TimeZoneFormatOptions, 'fallback'> = {}): Intl.DateTimeFormat {
  const { locale, ...intl } = options;
  const resolved: Intl.DateTimeFormatOptions = { ...intl, timeZone: intl.timeZone ?? getDisplayTimeZone() };
  try {
    return cachedFormatter(locale, resolved);
  } catch {
    return cachedFormatter(locale, { ...resolved, timeZone: 'UTC' });
  }
}

function format(value: DateInput, options: TimeZoneFormatOptions | undefined, defaults: Intl.DateTimeFormatOptions): string {
  const { fallback = DEFAULT_FALLBACK, ...rest } = options ?? {};
  const date = toValidDate(value);
  if (!date) return fallback;
  const picksFields = FIELD_KEYS.some((key) => rest[key] !== undefined);
  return getDateTimeFormat(picksFields ? rest : { ...defaults, ...rest }).format(date);
}

/**
 * A date and time in the display zone (`Oct 26, 2026, 10:42 AM`).
 *
 * @param value - see {@link DateInput}.
 * @param options - default `{ dateStyle: 'medium', timeStyle: 'short' }`; any field option replaces the defaults.
 * @returns the formatted text, or the fallback (`'—'`).
 *
 * @example
 * ```ts
 * formatDateTime(job.createdAt);                    // in the user's zone
 * formatDateTime(backup.scheduledAt, { timeZone: 'UTC' });
 * ```
 *
 * @stability experimental
 */
export function formatDateTime(value: DateInput, options?: TimeZoneFormatOptions): string {
  return format(value, options, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A calendar date in the display zone (`Oct 26, 2026`).
 *
 * @param value - see {@link DateInput}.
 * @param options - default `{ dateStyle: 'medium' }`.
 * @returns the formatted text, or the fallback (`'—'`).
 *
 * @stability experimental
 */
export function formatDate(value: DateInput, options?: TimeZoneFormatOptions): string {
  return format(value, options, { dateStyle: 'medium' });
}

/**
 * A time of day in the display zone (`10:42 AM`).
 *
 * @param value - see {@link DateInput}.
 * @param options - default `{ timeStyle: 'short' }`.
 * @returns the formatted text, or the fallback (`'—'`).
 *
 * @stability experimental
 */
export function formatTime(value: DateInput, options?: TimeZoneFormatOptions): string {
  return format(value, options, { timeStyle: 'short' });
}

function zonedParts(date: Date, timeZone: string): Record<string, number> {
  const parts = getDateTimeFormat({
    locale: 'en-US',
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const out: Record<string, number> = {};
  for (const part of parts) if (part.type !== 'literal') out[part.type] = Number(part.value);
  return out;
}

/**
 * The calendar day of a moment in a zone, as `YYYY-MM-DD`: the key to group
 * rows by day or to tell "Today" from "Yesterday".
 *
 * @param value - see {@link DateInput}.
 * @param timeZone - default: the display zone.
 * @returns the key, or `null` for an empty or invalid value.
 *
 * @example
 * ```ts
 * const isToday = zonedDateKey(row.createdAt) === zonedDateKey(new Date());
 * ```
 *
 * @stability experimental
 */
export function zonedDateKey(value: DateInput, timeZone?: string): string | null {
  const date = toValidDate(value);
  if (!date) return null;
  const { year = 0, month = 0, day = 0 } = zonedParts(date, timeZone ?? getDisplayTimeZone());
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The zone's offset from UTC at a moment, in minutes (`-360` for Costa Rica,
 * `330` for India); daylight saving time included.
 *
 * @param timeZone - an IANA zone id.
 * @param at - the moment; default now.
 * @returns minutes east of UTC.
 *
 * @stability experimental
 */
export function getTimeZoneOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, (p.hour ?? 0) % 24, p.minute ?? 0, p.second ?? 0);
  const whole = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((asUtc - whole) / 60_000);
}

/**
 * An offset as `UTC−06:00`, `UTC+05:30` or `UTC` (with the minus sign U+2212).
 *
 * @param minutes - minutes east of UTC.
 * @returns the label.
 *
 * @stability experimental
 */
export function formatUtcOffset(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes === 0) return 'UTC';
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(Math.round(minutes));
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
