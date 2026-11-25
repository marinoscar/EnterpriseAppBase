// Pure zone math (no zod despite the slice file layout); see README.
/**
 * A `YYYY-MM-DD` calendar day.
 *
 * @stability experimental
 */
export type DateKey = string;

/**
 * Wall-clock fields of an instant in a zone.
 *
 * @stability experimental
 */
export interface ZonedParts {
  /** The four-digit year. */
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  /** Day of the month, 1 to 31. */
  readonly day: number;
  /** 0 to 23. */
  readonly hour: number;
  /** 0 to 59. */
  readonly minute: number;
  /** 0 to 59. */
  readonly second: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

function toMs(instant: Date | number): number {
  return typeof instant === 'number' ? instant : instant.getTime();
}

/**
 * The wall-clock fields of `instant` in `timeZone`.
 *
 * @param instant - the instant.
 * @param timeZone - an IANA zone id.
 * @returns year, month (1-12), day, hour, minute and second there.
 *
 * @stability experimental
 */
export function getZonedParts(instant: Date | number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(toMs(instant))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  };
}

/**
 * Minutes the zone is ahead of UTC at `instant` (positive east, so
 * `America/Costa_Rica` is `-360`). DST-aware.
 *
 * @param instant - the instant.
 * @param timeZone - an IANA zone id.
 * @returns the offset in minutes.
 *
 * @stability experimental
 */
export function getTimeZoneOffsetMinutes(instant: Date | number, timeZone: string): number {
  const ms = toMs(instant);
  const p = getZonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop the sub-second part so it does not skew the minute count.
  const wholeSecond = Math.floor(ms / 1000) * 1000;
  return Math.round((asUtc - wholeSecond) / MINUTE_MS);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * The calendar day (`YYYY-MM-DD`) `instant` falls on in `timeZone`.
 *
 * @param instant - the instant.
 * @param timeZone - an IANA zone id.
 * @returns the zone's calendar day.
 *
 * @stability experimental
 */
export function zonedDateKey(instant: Date | number, timeZone: string): DateKey {
  const p = getZonedParts(instant, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Whether `value` is a well-formed `YYYY-MM-DD` that names a real day.
 *
 * @stability experimental
 */
export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string') return false;
  const m = DATE_KEY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function parseKey(day: string): { y: number; m: number; d: number } {
  if (!isDateKey(day)) throw new RangeError(`Not a YYYY-MM-DD day: ${day}`);
  const m = DATE_KEY.exec(day)!;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/**
 * `day` shifted by whole calendar days, with no time zone involved.
 *
 * @param day - a `YYYY-MM-DD` day.
 * @param days - days to add (negative subtracts).
 * @returns the shifted day.
 *
 * @stability experimental
 */
export function addDaysToDateKey(day: DateKey, days: number): DateKey {
  const { y, m, d } = parseKey(day);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * The instant at which the wall clock in `timeZone` reads the given fields.
 * A repeated local time (clocks going back) resolves to the earlier instant; a
 * skipped one (clocks going forward) resolves to the first instant after the gap.
 */
function zonedWallToInstant(
  fields: { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number },
  timeZone: string,
): Date {
  const localMs = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second, fields.ms);
  const offsets = new Set([
    getTimeZoneOffsetMinutes(localMs - DAY_MS, timeZone),
    getTimeZoneOffsetMinutes(localMs + DAY_MS, timeZone),
  ]);
  const candidates = [...offsets].map((o) => localMs - o * MINUTE_MS);
  const valid = candidates.filter((c) => localMs - getTimeZoneOffsetMinutes(c, timeZone) * MINUTE_MS === c);
  if (valid.length > 0) return new Date(Math.min(...valid));
  // Inside a gap: the wall time never happened. Use the pre-transition offset,
  // which lands on the first instant after the gap.
  return new Date(Math.max(...candidates));
}

/**
 * The instant of local midnight at the start of `day` in `timeZone`. DST-safe:
 * the day may be 23 or 25 hours long, and where midnight itself is skipped the
 * day starts at the first instant after the gap.
 *
 * @param day - a `YYYY-MM-DD` day.
 * @param timeZone - an IANA zone id.
 * @returns the day's first instant.
 *
 * @stability experimental
 */
export function zonedDayStart(day: DateKey, timeZone: string): Date {
  const { y, m, d } = parseKey(day);
  return zonedWallToInstant({ year: y, month: m, day: d, hour: 0, minute: 0, second: 0, ms: 0 }, timeZone);
}

/**
 * What {@link addCalendarInZone} adds: whole days or whole months.
 *
 * @stability experimental
 */
export type CalendarDuration =
  | {
      /** Calendar days to add (negative to subtract). */
      readonly days: number;
    }
  | {
      /** Calendar months to add (negative to subtract); the day clamps to the month's last day. */
      readonly months: number;
    };

/**
 * `instant` plus calendar days or months, computed on the wall clock of
 * `timeZone` so the time of day is kept across DST changes. A month step clamps
 * to the end of a shorter month (Jan 31 plus one month is Feb 28, or 29 in a
 * leap year).
 *
 * @param instant - the starting instant.
 * @param duration - `{ days }` or `{ months }` (integers, negative allowed).
 * @param timeZone - an IANA zone id.
 * @returns the resulting instant.
 *
 * @stability experimental
 */
export function addCalendarInZone(instant: Date | number, duration: CalendarDuration, timeZone: string): Date {
  const ms = toMs(instant);
  const p = getZonedParts(ms, timeZone);
  const subMs = ((ms % 1000) + 1000) % 1000;
  let { year, month, day } = p;
  if ('days' in duration) {
    const shifted = new Date(Date.UTC(year, month - 1, day + duration.days));
    year = shifted.getUTCFullYear();
    month = shifted.getUTCMonth() + 1;
    day = shifted.getUTCDate();
  } else {
    const total = year * 12 + (month - 1) + duration.months;
    year = Math.floor(total / 12);
    month = (total % 12 + 12) % 12 + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    day = Math.min(day, lastDay);
  }
  return zonedWallToInstant({ year, month, day, hour: p.hour, minute: p.minute, second: p.second, ms: subMs }, timeZone);
}
