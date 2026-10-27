// Mapping a date filter onto a server query. A DataTable date filter carries
// calendar days (`YYYY-MM-DD`); a server filters instants. The honest mapping
// is the half-open instant range [start of `from`, start of the day after
// `to`) in the viewer's zone, computed with the contract's DST-safe
// `zonedDayStart`, the same function the API uses to cut days.

import { addDaysToDateKey, isDateKey, zonedDayStart } from '@marinoscar/platform-contract/timezone';

import { getDisplayTimeZone } from '../../../core/index.js';

/**
 * What {@link zonedDayRangeToInstants} returns: a half-open instant range.
 *
 * @stability experimental
 */
export interface ZonedDayInstantRange {
  /** Local midnight at the start of the first day, ISO 8601 (inclusive). */
  from: string;
  /** Local midnight at the start of the day after the last day, ISO 8601 (exclusive). */
  to: string;
}

/**
 * The ISO instants that bound the calendar days `fromKey` to `toKey`
 * (inclusive) in `tz`: `from` is local midnight at the start of `fromKey`,
 * `to` is local midnight at the start of the day after `toKey`, so a server
 * filters `createdAt >= from AND createdAt < to`. DST-safe: a 23- or 25-hour
 * day is covered exactly, and a skipped midnight starts at the first instant
 * after the gap.
 *
 * Use it to turn a `date` filter (`between`, `after`, `before`) into server
 * query parameters, rather than sending the bare days (which a server would
 * read in its own zone) or `new Date(key)` (which is UTC midnight).
 *
 * @param fromKey - the first day, `YYYY-MM-DD`.
 * @param toKey - the last day included, `YYYY-MM-DD`; default `fromKey` (one day).
 * @param tz - an IANA zone id; default the display zone. An unknown zone reads as UTC.
 * @returns the half-open range as ISO 8601 instants.
 * @throws RangeError when a key is not a real `YYYY-MM-DD` day.
 *
 * @example
 * ```ts
 * // A "between 2026-10-01 and 2026-10-31" filter, for a viewer in Costa Rica:
 * zonedDayRangeToInstants('2026-10-01', '2026-10-31', 'America/Costa_Rica');
 * // { from: '2026-10-01T06:00:00.000Z', to: '2026-11-01T06:00:00.000Z' }
 * ```
 *
 * @stability experimental
 */
export function zonedDayRangeToInstants(
  fromKey: string,
  toKey: string = fromKey,
  tz: string = getDisplayTimeZone(),
): ZonedDayInstantRange {
  if (!isDateKey(fromKey)) throw new RangeError(`Not a YYYY-MM-DD day: ${fromKey}`);
  if (!isDateKey(toKey)) throw new RangeError(`Not a YYYY-MM-DD day: ${toKey}`);
  const start = (day: string): Date => {
    try {
      return zonedDayStart(day, tz);
    } catch {
      return zonedDayStart(day, 'UTC');
    }
  };
  return {
    from: start(fromKey).toISOString(),
    to: start(addDaysToDateKey(toKey, 1)).toISOString(),
  };
}
