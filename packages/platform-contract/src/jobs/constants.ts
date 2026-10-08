// =============================================================================
// Jobs: plain values of the admin job routes' wire shapes (issue #734, PP-8.2)
// =============================================================================
//
// Zod-free, so a consumer that needs only a status list, a window or a bound
// (the web app) never bundles schemas.ts or zod. Moved from the API slice's
// dto files with their comments; the API re-exports them.
// =============================================================================

/**
 * The four `JobStatus` values, as a tuple Zod can build an enum from.
 *
 * Kept as a local literal rather than derived from Prisma's generated enum
 * object: `z.enum` needs a tuple whose members are literal types, and the
 * generated value is a plain object whose keys would widen to `string`.
 *
 * Drift in EITHER direction is a compile error, which is the only reason a
 * hand-copied list is acceptable here. `satisfies` catches a value this file
 * lists that the schema does not have; `Exhaustive` below catches a value the
 * schema has that this file forgot — the direction that would otherwise fail
 * silently, publishing a filter enum that cannot express a real row's status.
 *
 * @stability experimental
 */
export const JOB_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
] as const;

/**
 * One job status: `pending`, `running`, `succeeded` or `failed`.
 *
 * @stability experimental
 */
export type JobStatusName = (typeof JOB_STATUSES)[number];

/**
 * The three `JobReason` values, for the same reason and with the same guards.
 *
 * @stability experimental
 */
export const JOB_REASONS = [
  'upload',
  'rerun',
  'backfill',
] as const;

/**
 * The activity windows the list offers, longest-lived value last.
 *
 * @stability experimental
 */
export const PROCESSED_WITHIN_VALUES = ['4h', '24h', '7d', '30d', 'all'] as const;

/**
 * One activity window of the job list.
 *
 * @stability experimental
 */
export type ProcessedWithin = (typeof PROCESSED_WITHIN_VALUES)[number];

/**
 * How far back each window reaches, in milliseconds.
 *
 * `all` is absent rather than mapped to `Infinity` or to `0`: the service
 * branches on "is there a window at all", and a sentinel number would invite a
 * `new Date(now - Infinity)` — an Invalid Date that Prisma sends as `NULL`,
 * which silently matches nothing.
 *
 * @stability experimental
 */
export const PROCESSED_WITHIN_MS: Readonly<Record<Exclude<ProcessedWithin, 'all'>, number>> = {
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/**
 * The window used when the caller does not ask for one.
 *
 * @stability experimental
 */
export const DEFAULT_INSIGHTS_WINDOW_DAYS = 7;

/**
 * The largest window this endpoint will compute over.
 *
 * A CEILING, NOT A SUGGESTION. The history block sorts every succeeded job in
 * the window to compute percentiles, so its cost is linear in the number of
 * rows the window admits — and "how many jobs finished in the last N days" is
 * not a number this code bounds. Ninety days is comfortably longer than any
 * "is it getting slower?" question needs and short enough that the query stays
 * an index range scan rather than a table sort.
 *
 * A larger value is REJECTED (400) rather than silently reduced: an operator
 * who asked for a year and got a quarter, with a response that looks exactly
 * like the one they asked for, would compare it against last month's numbers
 * and draw a conclusion about a window that was never computed. The service
 * clamps as well, so a direct call cannot escape the bound either — see
 * `job-insights.service.ts`.
 *
 * @stability experimental
 */
export const MAX_INSIGHTS_WINDOW_DAYS = 90;

/**
 * How far back `throughputPerMin` looks, in milliseconds.
 *
 * ONE HOUR, and deliberately NOT the whole window: throughput is the answer to
 * "how fast is the queue moving right now", and averaging it over a week turns
 * a queue that stopped an hour ago into one that looks healthy. It is a
 * sub-window of the smallest permitted window (one day), so it is always fully
 * contained by the rows the history query already scanned — which is why it
 * costs no extra query at all.
 *
 * @stability experimental
 */
export const THROUGHPUT_WINDOW_MS = 60 * 60 * 1000;

/**
 * The three answers to "where did this estimate's average come from".
 * See the header — the field exists so a UI can phrase its own confidence.
 *
 * @stability experimental
 */
export const JOB_ETA_BASES = ['live', 'partial', 'none'] as const;

/**
 * What an ETA's per-job average came from.
 *
 * @stability experimental
 */
export type JobEtaBasis = (typeof JOB_ETA_BASES)[number];
