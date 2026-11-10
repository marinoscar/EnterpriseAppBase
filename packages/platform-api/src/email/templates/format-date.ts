// =============================================================================
// Date rendering for email templates (follows the recipient's time zone)
// =============================================================================
//
// A message is rendered in the RECIPIENT's zone (`EmailRenderContext.timeZone`,
// from the recipient's `profile.timezone`), with the zone's short name always
// printed. When the zone is not UTC, the UTC time follows in parentheses,
// because these timestamps are matched against log lines and delivery records,
// which are UTC:
//
//   Oct 26, 2026, 9:42 PM CDT (Oct 27, 02:42 UTC)
//
// Pure and framework-free. No clock: the value is passed in.
// =============================================================================

import { DEFAULT_SERVER_TIME_ZONE, zonedDateKey } from '@marinoscar/platform-contract/timezone';

/**
 * What the formatters read from the render context.
 *
 * @stability experimental
 */
export interface EmailDateContext {
  /** IANA zone to render in; absent, `null` or invalid means UTC. */
  readonly timeZone?: string | null;
}

/**
 * A value a template may format: a `Date`, epoch milliseconds or an ISO string.
 *
 * @stability experimental
 */
export type EmailDateInput = Date | number | string;

function toDate(value: EmailDateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The zone to render in: the context's when the runtime knows it, else UTC. */
function effectiveZone(ctx: EmailDateContext | undefined): string {
  const zone = ctx?.timeZone;
  if (!zone) return DEFAULT_SERVER_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_SERVER_TIME_ZONE;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcDay(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function utcClock(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

/**
 * Formats an instant for an email: medium date, short time and the zone's short
 * name, in `ctx.timeZone` (UTC when absent or invalid). Outside UTC the UTC time
 * is appended in parentheses.
 *
 * @param value - the instant (a `Date`, epoch milliseconds or an ISO string).
 * @param ctx - the render context (only `timeZone` is read).
 * @returns e.g. `Oct 26, 2026, 9:42 PM CDT (Oct 27, 02:42 UTC)`, with the UTC date added when it differs from the local one, or `Unknown time` for an unparseable value.
 *
 * @stability experimental
 */
export function formatEmailDateTime(value: EmailDateInput, ctx?: EmailDateContext): string {
  const date = toDate(value);
  if (!date) return 'Unknown time';
  const timeZone = effectiveZone(ctx);
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date).replace(/[\u202f\u00a0]/g, ' '); // newer ICU puts a narrow no-break space before AM/PM
  if (timeZone === DEFAULT_SERVER_TIME_ZONE || local.endsWith(' UTC')) return local;
  // When the UTC calendar day differs from the local one, name it, or the suffix misleads.
  const sameDay = zonedDateKey(date, timeZone) === zonedDateKey(date, DEFAULT_SERVER_TIME_ZONE);
  return `${local} (${sameDay ? '' : `${utcDay(date)}, `}${utcClock(date)})`;
}

/**
 * Formats the calendar day of an instant in `ctx.timeZone` (UTC when absent or
 * invalid), with the zone's short name: `Oct 26, 2026 (CDT)`.
 *
 * @param value - the instant.
 * @param ctx - the render context (only `timeZone` is read).
 * @returns the day and zone label, or `Unknown date` for an unparseable value.
 *
 * @stability experimental
 */
export function formatEmailDate(value: EmailDateInput, ctx?: EmailDateContext): string {
  const date = toDate(value);
  if (!date) return 'Unknown date';
  const timeZone = effectiveZone(ctx);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZoneName: 'short',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // Same normalisation as above.
  return `${pick('month')} ${pick('day')}, ${pick('year')} (${pick('timeZoneName')})`;
}
