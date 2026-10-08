// =============================================================================
// Jobs: the admin job routes' wire shapes (issue #734, PP-8.2)
// =============================================================================
//
// `GET /api/admin/jobs` (list query and row), `/stats`, `/insights` and the
// bulk actions' bodies and results, as zod schemas. Moved verbatim (comments
// included) from `@marinoscar/platform-api/jobs`'s dto files, which now wrap
// these with `createZodDto`. Node result schemas are NOT here: they stay with
// their handlers and cross to nodes as JSON Schema (`GET /api/nodes/job-types`).
// =============================================================================

import { z } from 'zod';

import {
  DEFAULT_INSIGHTS_WINDOW_DAYS,
  JOB_ETA_BASES,
  JOB_REASONS,
  JOB_STATUSES,
  MAX_INSIGHTS_WINDOW_DAYS,
  PROCESSED_WITHIN_VALUES,
} from './constants.js';

/**
 * The entries of the job status enum.
 *
 * @stability experimental
 */
export type JobStatusEnum = { [K in (typeof JOB_STATUSES)[number]]: K };

/**
 * The entries of the job reason enum.
 *
 * @stability experimental
 */
export type JobReasonEnum = { [K in (typeof JOB_REASONS)[number]]: K };

/**
 * The entries of the processed-within window enum.
 *
 * @stability experimental
 */
export type ProcessedWithinEnum = { [K in (typeof PROCESSED_WITHIN_VALUES)[number]]: K };

/**
 * The entries of the ETA basis enum.
 *
 * @stability experimental
 */
export type JobEtaBasisEnum = { [K in (typeof JOB_ETA_BASES)[number]]: K };

/**
 * The entries of a boolean query flag (`'true'` / `'false'`).
 *
 * @stability experimental
 */
export type JobBooleanFlagEnum = { [K in 'true' | 'false']: K };

// -----------------------------------------------------------------------------
// From job-response.dto.ts: One `jobs` row, as the admin API publishes it (issue #264, epic #254)
// -----------------------------------------------------------------------------
// =============================================================================
// One `jobs` row, as the admin API publishes it (issue #264, epic #254)
// =============================================================================
//
// This schema describes the JSON an operator receives, NOT the Prisma model.
// The two differ in three deliberate ways, and each one is a decision rather
// than an oversight:
//
//   1. TIMESTAMPS ARE ISO STRINGS, not `Date`s. `JobAdminService` hands the
//      controller the Prisma row and the serializer turns every `Date` into an
//      ISO-8601 string on the way out. Documenting `z.date()` here would
//      publish a type no HTTP client can ever receive. This mirrors
//      `allowlist/dto/allowlist-response.dto.ts`, which describes its own
//      response the same way and for the same reason.
//
//   2. `typeLabel` IS ADDED. `type` is a machine key (`'example.echo'`) and is
//      what every filter matches on, so it must stay on the wire verbatim. The
//      label is resolved server-side through `jobTypeLabel()` rather than
//      shipped as a map the client joins against, because that helper's whole
//      contract is "an unmapped type renders as itself, never blank" (see
//      `job-type-labels.ts`) — and a client doing its own lookup is a client
//      that can forget the `?? type` fallback and render an empty cell for
//      exactly the job types a fork cares most about.
//
//   3. `payload` IS OMITTED, and this is the one worth arguing. A job's
//      payload is arbitrary application JSONB with no size bound anywhere in
//      the schema; a hundred rows of it is a response whose size is set by
//      whatever a fork's largest handler input happens to be, on an endpoint
//      that a dashboard polls. The fields an operator actually triages with —
//      `type`, `subjectType`/`subjectId`, `attempts`, `lastError`, the
//      timestamps — are all here, and `subjectType`/`subjectId` exist
//      precisely so that "which thing was this job about" is answerable
//      without reading the payload. A later per-job detail route can publish
//      the payload for ONE row, where its size is bounded by construction;
//      putting it in a paginated list is the shape that cannot be made safe.
//
// These DTO classes are documentation, not runtime validation. Nothing parses
// a response through them — `createZodDto` is used because it is how every
// other schema in this API reaches the OpenAPI document.
// =============================================================================

/**
 * One `jobs` row as `GET /api/admin/jobs` lists it (no payload, no claim token).
 *
 * @stability experimental
 */
export const jobSchema = z.object({
  /** The job id (UUID). */
  id: z.uuid(),

  /** The machine key a handler is registered under; what `type=` filters on. */
  type: z.string(),
  /** `type` run through `jobTypeLabel()`; equal to `type` when unmapped. */
  typeLabel: z.string(),

  /** What this job is about, when the enqueuer said so. */
  subjectType: z.string().nullable(),
  /** Which one, when the enqueuer named a subject. */
  subjectId: z.string().nullable(),

  /**
   * The active-dedup key. Non-null only when the enqueuer wanted collapsing;
   * see `jobs.service.ts` for why a NULL key can never collide.
   */
  dedupKey: z.string().nullable(),

  /** Lifecycle status: `pending`, `running`, `succeeded` or `failed`. */
  status: (z.enum(JOB_STATUSES) as z.ZodEnum<JobStatusEnum>),
  /** Why it was queued: `upload`, `rerun` or `backfill`. */
  reason: (z.enum(JOB_REASONS) as z.ZodEnum<JobReasonEnum>),
  /** Ascending is more urgent; the claim orders by it first. */
  priority: z.number().int(),

  /** The provider throttle bucket the work ran under, when it calls a rate-limited provider. */
  providerKey: z.string().nullable(),
  /** The model version the work ran under, when there is one. */
  modelVersion: z.string().nullable(),

  /** Attempts STARTED, charged at claim time — not attempts that reported back. */
  attempts: z.number().int(),
  /** The last failure's message, bounded; never secret material. */
  lastError: z.string().nullable(),

  /** When it was queued (ISO 8601). */
  createdAt: z.iso.datetime(),
  /** When the current (or last) attempt started (ISO 8601). */
  startedAt: z.iso.datetime().nullable(),
  /** When it reached a terminal status (ISO 8601). */
  finishedAt: z.iso.datetime().nullable(),

  /** When set in the future on a `pending` row, the job is in backoff. */
  scheduledFor: z.iso.datetime().nullable(),

  /** When a provider last rate-limited it (ISO 8601). */
  rateLimitedAt: z.iso.datetime().nullable(),
  /** Rate-limit deferrals so far; not charged against `attempts`. */
  rateLimitHits: z.number().int(),

  /** Ownership, while a row is claimed. All three are cleared by a retry. */
  claimedByNodeId: z.uuid().nullable(),
  /** When the current claim's lease runs out (ISO 8601). */
  leaseExpiresAt: z.iso.datetime().nullable(),
  /** `server` or `node`: who runs (or ran) the current attempt. */
  executor: z.string().nullable(),

  /**
   * The organization the work belongs to (#734), or `null` for a
   * deployment-wide (system) job such as housekeeping.
   */
  orgId: z.uuid().nullable(),
});

// -----------------------------------------------------------------------------
// From job-list-query.dto.ts: The job list's filters (issue #264, epic #254)
// -----------------------------------------------------------------------------
// =============================================================================
// The job list's filters (issue #264, epic #254)
// =============================================================================
//
// Seven query parameters, every one of which exists because an operator with a
// misbehaving queue asks a specific question. The three that are more than a
// plain column match are documented individually below; the rest (`type`,
// `subjectType`, `subjectId`, `page`, `pageSize`) are exactly what they look
// like, and `page`/`pageSize` are copied field-for-field from
// `users/dto/user-list-query.dto.ts` so that every paginated list in this API
// takes the same names and enforces the same 100-row ceiling.
//
// -----------------------------------------------------------------------------
// `scheduled` IS A BOOLEAN THAT OVERRIDES `status`, NOT A FIFTH STATUS
// -----------------------------------------------------------------------------
//
// "In backoff" is not a status — it is a `pending` row whose `scheduled_for`
// is still in the future, which is how `job-terminal.service.ts` records a
// retry and how `provider-throttle.service.ts` records a rate-limit deferral.
// There was a real temptation to publish it as `status=scheduled`, and it was
// rejected: `status` is a database enum with four values, a filter value that
// is not one of them cannot round-trip against a row, and a client would then
// have a `status` field whose vocabulary differs from the `status` field on
// every row it receives.
//
// So it is a separate boolean, and `scheduled=true` FORCES `status=pending`
// rather than intersecting with whatever `status` was also sent. The
// alternative — honouring both, so `?scheduled=true&status=failed` returns
// nothing — is technically defensible and practically useless: the request is
// a contradiction, and answering a contradiction with an empty page tells the
// operator that no such job exists, when what is true is that no such job CAN
// exist. Overriding answers the question they meant. `JobAdminService.list`
// is where that precedence is applied, so it is one rule in one place.
//
// -----------------------------------------------------------------------------
// `processedWithin` IS AN ACTIVITY WINDOW, NOT A `createdAt` WINDOW
// -----------------------------------------------------------------------------
//
// It filters on `COALESCE(finished_at, created_at)`: when a job last did
// something, falling back to when it appeared if it has not finished. A plain
// `createdAt >= …` window would hide the single most interesting row on the
// dashboard — a job enqueued two days ago that failed ninety seconds ago —
// from the "last 4 hours" view, which is the view an operator opens while the
// incident is happening.
//
// Prisma has no `COALESCE` in a `where`, so it is expressed as the two
// disjoint cases, `{ finishedAt: { gte } }` OR `{ finishedAt: null, createdAt:
// { gte } }`. They are disjoint because the second pins `finishedAt` to null,
// so no row can match both and no row is double-counted by a `count`.
//
// `all` is the DEFAULT and is a real value rather than an absent parameter:
// an operator hunting a rare historical failure needs a way to say "no window"
// that is visible in the URL, and a dashboard needs a value to put in its
// dropdown. Making a window the default would mean the unfiltered list
// silently hides rows.
// =============================================================================

/**
 * The query of `GET /api/admin/jobs`: filters, the activity window and pagination.
 *
 * @stability experimental
 */
export const jobListQuerySchema = z.object({
  /** The 1-based page; default 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Rows per page; default 20, at most 100. */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),

  /** Only jobs in this status. */
  status: (z.enum(JOB_STATUSES) as z.ZodEnum<JobStatusEnum>).optional(),
  /** Only jobs of this type (an exact match on the machine key). */
  type: z.string().min(1).max(200).optional(),
  /** Only jobs about this kind of subject. */
  subjectType: z.string().min(1).max(200).optional(),
  /** Only jobs about this subject. */
  subjectId: z.string().min(1).max(200).optional(),
  /**
   * Only this organization's jobs (#734). Omitted, every job is listed,
   * deployment-wide system jobs (`orgId: null`) included.
   */
  orgId: z.uuid().optional(),

  /**
   * `z.enum(['true','false']).transform(...)` and NOT `z.coerce.boolean()`.
   *
   * Every query parameter arrives as a string, and `Boolean('false')` is
   * `true` — so a coercing schema would turn the explicit opt-OUT
   * `?scheduled=false` into the opt-IN, which is the worst possible direction
   * for a filter that overrides `status`. The same reasoning, and the same
   * shape, as `notifications/dto/notification.dto.ts` and
   * `users/dto/user-list-query.dto.ts`.
   */
  scheduled: (z.enum(['true', 'false']) as z.ZodEnum<JobBooleanFlagEnum>)
    .transform((value) => value === 'true')
    .optional(),

  /** Only jobs that finished (or, unfinished, were created) within this window; default `all`. */
  processedWithin: (z.enum(PROCESSED_WITHIN_VALUES) as z.ZodEnum<ProcessedWithinEnum>).default('all'),
});

/**
 * The parsed, defaulted shape `JobAdminService.list` consumes.
 *
 * @stability experimental
 */
export type JobListQuery = z.output<typeof jobListQuerySchema>;

// -----------------------------------------------------------------------------
// From job-stats.dto.ts: The queue's summary (issue #264, epic #254)
// -----------------------------------------------------------------------------
// =============================================================================
// The queue's summary (issue #264, epic #254)
// =============================================================================
//
// What a dashboard polls: how much work exists, in what state, of what type,
// and how much of it is in trouble. One request, because the alternative — a
// count endpoint per tile — is five round trips whose answers are taken at
// five different instants, so the tiles do not add up and an operator learns
// to distrust the page.
//
// -----------------------------------------------------------------------------
// EVERY STATUS KEY IS ALWAYS PRESENT, INCLUDING THE ZEROES
// -----------------------------------------------------------------------------
//
// `byStatus` and each entry's `byStatus` are zero-filled from `JOB_STATUSES`
// before the `groupBy` rows are folded in. A `GROUP BY` returns no row for a
// status nothing is in, so the natural shape of this response is one where
// `failed` is simply absent on a healthy queue — and a client rendering
// `stats.byStatus.failed` then shows `undefined` exactly when everything is
// fine. Zero-filling makes "no failures" and "the key is missing" the same
// thing on the wire, which is what a tile can render without a fallback.
//
// -----------------------------------------------------------------------------
// `stuckThresholdMinutes` IS PUBLISHED BECAUSE `stuckRunning` IS MEANINGLESS
// WITHOUT IT
// -----------------------------------------------------------------------------
//
// `stuckRunning` is a count against a threshold the caller cannot see: it
// lives in the `jobs.stuckThresholdMinutes` system setting, it is read through
// `JobStuckService.getStuckThresholdMinutes()`, and it can be changed while
// the dashboard is open. A UI that showed "4 stuck" and had to hardcode "(over
// 30 minutes)" would go on saying 30 after an operator moved the setting to 5,
// which turns a status line into a false one. Sending the number that was
// ACTUALLY used for this response removes that possibility.
//
// It is also what the `reset-stuck` control needs to prefill its "older than"
// input with the value an empty body would use.
// =============================================================================

/**
 * Counts per status, zero-filled — every key is always present.
 *
 * @stability experimental
 */
export const jobStatusCountsSchema = z.object({
  /** Jobs waiting to be claimed (including those in backoff). */
  pending: z.number().int(),
  /** Jobs claimed and in progress. */
  running: z.number().int(),
  /** Jobs that finished successfully. */
  succeeded: z.number().int(),
  /** Jobs that failed permanently. */
  failed: z.number().int(),
});

/**
 * Counts per status, every key present.
 *
 * @stability experimental
 */
export type JobStatusCounts = z.output<typeof jobStatusCountsSchema>;

/**
 * One row of the by-type breakdown.
 *
 * Ordered by `total` descending then `type` ascending in the service, so the
 * busiest type is first and the order is stable between two polls that see the
 * same counts — a table whose rows reshuffle every two seconds is unreadable.
 *
 * @stability experimental
 */
export const jobTypeStatsSchema = z.object({
  /** The job type. */
  type: z.string(),
  /** `type` through `jobTypeLabel()`; equal to `type` when unmapped. */
  label: z.string(),
  /** Every row of this type. */
  total: z.number().int(),
  /** Its rows per status. */
  byStatus: jobStatusCountsSchema,
});

/**
 * The body of `GET /api/admin/jobs/stats`: the queue's summary.
 *
 * @stability experimental
 */
export const jobStatsSchema = z.object({
  /** Every `jobs` row, whatever its status or age. */
  total: z.number().int(),

  /** Every row per status. */
  byStatus: jobStatusCountsSchema,
  /** Per-type breakdown, busiest first. */
  byType: z.array(jobTypeStatsSchema),

  /**
   * `pending` rows whose `scheduledFor` is still in the future — retry
   * backoff and rate-limit deferrals. A subset of `byStatus.pending`, never a
   * fifth status; see `job-list-query.dto.ts` for why that distinction is
   * kept on the wire.
   */
  scheduled: z.number().int(),

  /**
   * `running` rows the lease reaper would reclaim right now, counted with the
   * reaper's own `stuckRunningWhere()` so the dashboard and the sweeper can
   * never disagree about which rows those are.
   */
  stuckRunning: z.number().int(),

  /** The threshold `stuckRunning` was computed against, in minutes. */
  stuckThresholdMinutes: z.number().int().positive(),

  /** When these counts were taken. Every field above shares this instant. */
  generatedAt: z.iso.datetime(),
});

// -----------------------------------------------------------------------------
// From job-insights.dto.ts: The queue's insights response (issue #265, epic #254)
// -----------------------------------------------------------------------------
// =============================================================================
// The queue's insights response (issue #265, epic #254)
// =============================================================================
//
// `stats` (#264) answers "what is the queue doing right now". This answers the
// two questions it structurally cannot: "how long will this take" and "is it
// getting faster or slower". One response, four blocks, because an operator
// reading a backlog wants the backlog, its recent speed and the resulting
// estimate to have been taken at the SAME instant — three endpoints polled
// separately produce an ETA computed from a queue depth that has already
// changed, which is how a progress number ends up going backwards.
//
// -----------------------------------------------------------------------------
// `avgMs`, `p50Ms` AND `p95Ms` ARE NULLABLE, AND ZERO WOULD BE A LIE
// -----------------------------------------------------------------------------
//
// A type with no succeeded jobs inside the window has no average duration.
// The tempting shape is `avgMs: 0`, and it is wrong twice over: a UI renders
// "0 ms" as a fact ("this job type is instant"), and the ETA below MULTIPLIES
// this number by a queue depth — so a zero average turns a thousand queued
// jobs into an estimate of "done already". `null` is the only value a client
// cannot accidentally do arithmetic on, and it is what makes the ETA's
// three-step fallback (below) necessary rather than optional.
//
// `samples` is therefore the field that says whether the other three mean
// anything, and it is always a number.
//
// -----------------------------------------------------------------------------
// `basis` EXISTS BECAUSE AN ESTIMATE MUST SAY HOW MUCH OF IT IS REAL
// -----------------------------------------------------------------------------
//
// Every ETA in the response is `remaining x avgMs / concurrency`, but `avgMs`
// can come from three very different places:
//
//   - `live`    — this type's OWN succeeded jobs inside the window. The
//                 estimate is measurement.
//   - `partial` — the overall average across every type, because this type has
//                 no history of its own yet. The estimate is an analogy, and a
//                 bad one whenever job types differ in cost (they always do).
//   - `none`    — nothing has ever succeeded inside the window, so the number
//                 is a shipped constant. The estimate is a placeholder.
//
// Publishing only the milliseconds would make those three indistinguishable on
// the wire, and a UI would render all of them with the same confidence. With
// `basis` a client can say "about 4 minutes", "roughly 4 minutes, based on
// other job types" and "no idea yet" from one field — which is the difference
// between a useful estimate and a number nobody believes twice.
//
// -----------------------------------------------------------------------------
// `lifetime` HAS COUNTS AND AVERAGES AND NO PERCENTILES, DELIBERATELY
// -----------------------------------------------------------------------------
//
// Lifetime numbers are `JobStatsRollup` (the purged rows, #263) merged with
// the rows still in the table. A rollup row is four accumulators — two counts,
// a sum and a sample count — and those four are exactly the quantities that
// SURVIVE summarisation: counts add, and a mean can be reconstructed from a
// sum and a denominator.
//
// A percentile cannot. p95 is a position in a sorted distribution, and the
// distribution was deleted; nothing about `sumDurationMs` and
// `durationSamples` can recover it, and no scheme of storing "the p95 at purge
// time" and averaging it with a live p95 produces the p95 of the union — it
// produces a number that looks like one. So the rollup does not store
// percentiles and this block does not publish them. `history` publishes real
// percentiles over a bounded window, where the rows still exist to be sorted.
//
// The honest split is therefore: `history` = distribution over a window,
// `lifetime` = totals over all time. Neither pretends to be the other.
// =============================================================================

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * The query of `GET /api/admin/jobs/insights`: the history window in days.
 *
 * @stability experimental
 */
export const jobInsightsQuerySchema = z.object({
  /**
   * How many days of succeeded jobs the `history` block covers.
   *
   * `z.coerce` because every query parameter arrives as a string. The bounds
   * are the schema's, so an out-of-range value is a clean 400 from the global
   * `ZodValidationPipe` before this service ever runs a query.
   */
  windowDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_INSIGHTS_WINDOW_DAYS)
    .default(DEFAULT_INSIGHTS_WINDOW_DAYS),
});

/**
 * The parsed, defaulted shape `JobInsightsService.insights` consumes.
 *
 * @stability experimental
 */
export type JobInsightsQuery = z.output<typeof jobInsightsQuerySchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * Durations over one set of succeeded jobs. See the header on the nulls.
 *
 * @stability experimental
 */
export const jobDurationStatsSchema = z.object({
  /** Succeeded, fully timestamped jobs in the window. 0 means the rest is null. */
  samples: z.number().int(),

  /** Mean duration, or `null` when `samples` is 0. */
  avgMs: z.number().nullable(),

  /** Median, via `PERCENTILE_CONT(0.5)`. `null` when `samples` is 0. */
  p50Ms: z.number().nullable(),

  /**
   * 95th percentile, via `PERCENTILE_CONT(0.95)` — INTERPOLATED, not the
   * nearest sample (`PERCENTILE_DISC`), so a small sample set still moves the
   * number continuously as jobs get slower rather than jumping between two
   * observed durations.
   */
  p95Ms: z.number().nullable(),

  /**
   * Jobs succeeded per minute over the LAST HOUR — not over the window; see
   * `THROUGHPUT_WINDOW_MS`. `history.throughputSince` publishes the instant it
   * was measured from, so a client never has to hardcode "(last hour)".
   */
  throughputPerMin: z.number(),
});

/**
 * Duration percentiles of one population of succeeded jobs.
 *
 * @stability experimental
 */
export type JobDurationStats = z.output<typeof jobDurationStatsSchema>;

/**
 * Duration percentiles of one job type over the window.
 *
 * @stability experimental
 */
export const jobTypeDurationStatsSchema = jobDurationStatsSchema.extend({
  /** The job type. */
  type: z.string(),
  /** `type` through `jobTypeLabel()`; equal to `type` when unmapped. */
  label: z.string(),
});

/**
 * One job type's drain estimate.
 *
 * @stability experimental
 */
export const jobEtaSchema = z.object({
  /** The job type. */
  type: z.string(),
  /** Its display label (`jobTypeLabel`). */
  label: z.string(),

  /** Jobs of this type not yet finished: `pending + running`. */
  pending: z.number().int(),
  /** Jobs of this type running now. */
  running: z.number().int(),
  /** `pending + running`: what the estimate covers. */
  remaining: z.number().int(),

  /** The per-job average this estimate multiplied. Never null — see `basis`. */
  avgMs: z.number(),

  /** What the average came from: `live` (this window), `partial` (lifetime fallback) or `none`. */
  basis: (z.enum(JOB_ETA_BASES) as z.ZodEnum<JobEtaBasisEnum>),

  /** `remaining x avgMs / concurrency`, in milliseconds. */
  estimatedMs: z.number(),
});

/**
 * One job type's all-time totals (rollup plus live rows).
 *
 * @stability experimental
 */
export const jobLifetimeStatsSchema = z.object({
  /** The job type. */
  type: z.string(),
  /** Its display label (`jobTypeLabel`). */
  label: z.string(),

  /** Rollup (purged rows) plus the rows still in the table. Never both. */
  succeeded: z.number().int(),
  /** Failed, rollup plus live rows. */
  failed: z.number().int(),
  /** `succeeded + failed` — jobs that ran, whatever the outcome. */
  total: z.number().int(),

  /**
   * `(rollup.sumDurationMs + liveSum) / (rollup.durationSamples + liveSamples)`,
   * or `null` when nothing timed has ever succeeded for this type.
   */
  avgMs: z.number().nullable(),

  /** The denominator above, published so `avgMs` can be weighed. */
  durationSamples: z.number().int(),
});

/**
 * The body of `GET /api/admin/jobs/insights`: live counts, windowed history, lifetime totals and ETAs.
 *
 * @stability experimental
 */
export const jobInsightsSchema = z.object({
  /** The window actually used, after clamping. Echoed so a client can label it. */
  windowDays: z.number().int(),

  /** When every number below was taken. One instant for the whole response. */
  generatedAt: z.iso.datetime(),

  /**
   * `JOBS_WORKER_CONCURRENCY` as this process reads it — the divisor every
   * `eta.estimatedMs` used. Published for the same reason `stats` publishes
   * `stuckThresholdMinutes`: an estimate computed against a number the caller
   * cannot see is one a UI has to guess at, and it would guess wrong the
   * moment a deployment changed the setting.
   */
  concurrency: z.number().int(),

  /** The queue right now: the same counts as `GET /api/admin/jobs/stats`. */
  live: z.object({
    /** Every `jobs` row now. */
    total: z.number().int(),
    /** Every row per status. */
    byStatus: jobStatusCountsSchema,
    /** Per-type breakdown, busiest first. */
    byType: z.array(jobTypeStatsSchema),

    /** `pending` rows whose `scheduledFor` is still in the future. */
    scheduled: z.number().int(),

    /**
     * Non-terminal rows that have been deferred by a provider rate limit at
     * least once (`rateLimitHits > 0`). Terminal rows are excluded because a
     * job that finished is no longer being held up by anything.
     */
    rateLimited: z.number().int(),

    /**
     * Rows that have been claimed more than once (`attempts > 1`) — the
     * queue's flakiness signal, and the predicate `jobs_attempts_gt1_idx` was
     * built for. Includes terminal rows: "how much of this history needed a
     * second go" is the question.
     */
    retried: z.number().int(),
  }),

  /** Duration distribution of succeeded jobs over the window. */
  history: z.object({
    /** The oldest `finishedAt` the percentiles cover. */
    windowStart: z.iso.datetime(),
    /** The instant `throughputPerMin` counts from — one hour before `generatedAt`. */
    throughputSince: z.iso.datetime(),

    /**
     * Every succeeded job in the window, as ONE distribution.
     *
     * Not derivable from `byType`: a mean could be re-weighted, but p50 and
     * p95 cannot be combined from per-group percentiles at all. It is computed
     * in the same scan as `byType` (a `GROUPING SETS` grand total), so the two
     * always describe exactly the same rows.
     */
    overall: jobDurationStatsSchema,
    /** Per-type duration percentiles over the window. */
    byType: z.array(jobTypeDurationStatsSchema),
  }),

  /** One entry per type with work outstanding, slowest estimate first. */
  eta: z.array(jobEtaSchema),

  /** All-time totals per type: rollup + live, counts and averages only. */
  lifetime: z.array(jobLifetimeStatsSchema),
});

/**
 * The result of resetting the job history.
 *
 * @stability experimental
 */
export const resetHistoryResultSchema = z.object({
  /**
   * `JobStatsRollup` rows deleted.
   *
   * Rows, not jobs: one row per job type, each holding that type's whole
   * purged history. A deployment with four job types reports `4` however many
   * millions of jobs those four accumulators summarised.
   */
  reset: z.number().int(),
});

// -----------------------------------------------------------------------------
// From job-actions.dto.ts: The bodies and results of the four job actions (issue #264, epic #254)
// -----------------------------------------------------------------------------
// =============================================================================
// The bodies and results of the four job actions (issue #264, epic #254)
// =============================================================================
//
// Two request bodies, both entirely optional, and three result shapes. They
// share a file because each is a handful of numbers and because splitting them
// would put the request and the result of the same operation in different
// places, which is exactly where they drift.
//
// -----------------------------------------------------------------------------
// `olderThanMinutes` HAS NO DEFAULT, AND THAT ABSENCE IS THE FEATURE
// -----------------------------------------------------------------------------
//
// `resetStuckSchema` gives `olderThanMinutes` no `.default(...)`, so an empty
// body parses to `{}` and `JobStuckService.resetStuck(undefined)` falls
// through to `getStuckThresholdMinutes()` — the `jobs.stuckThresholdMinutes`
// system setting, the same number the lease reaper's cron sweep uses.
//
// A default here — even `.default(30)`, even spelled as
// `DEFAULT_SYSTEM_SETTINGS.jobs.stuckThresholdMinutes` — would be a SECOND
// place the threshold is decided, and it would win: the parsed value is always
// defined, so the service's settings lookup would become dead code reachable
// only from the cron. An operator who moved the setting to 5 minutes would
// then find the dashboard button still sweeping at 30 and no way to tell why.
// The value is deliberately allowed to be `undefined` all the way down to the
// one function that knows where the number lives.
//
// The parameter still exists because there is a real use for it: sweeping
// tighter than the configured threshold during an incident, without changing a
// setting that the cron will then keep using afterwards. `0` is permitted and
// means "every running job that matches any recovery signal, at any age" —
// the lease signal in `stuckRunningWhere()` is independent of the threshold,
// so `0` is not a synonym for "everything running".
// =============================================================================

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * The body of `POST /api/admin/jobs/retry-failed`.
 *
 * @stability experimental
 */
export const retryFailedSchema = z.object({
  /**
   * Restrict the sweep to one job type. Omitted, every failed job is retried.
   *
   * A plain equality match on the machine key, not a prefix or a glob: `type`
   * is what dispatch keys on, so "all the types starting with `billing.`" is a
   * question about a naming convention this queue does not enforce.
   */
  type: z.string().min(1).max(200).optional(),
});

/**
 * The body of `POST /api/admin/jobs/reset-stuck`.
 *
 * @stability experimental
 */
export const resetStuckSchema = z.object({
  /**
   * Sweep rows stuck for longer than this many minutes.
   *
   * DELIBERATELY UNDEFAULTED — see the file header. Omitting it defers to the
   * `jobs.stuckThresholdMinutes` system setting, which is the behaviour the
   * cron sweep already has.
   */
  olderThanMinutes: z.coerce.number().int().min(0).max(60 * 24 * 365).optional(),
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * The result of `POST /api/admin/jobs/retry-failed`.
 *
 * @stability experimental
 */
export const retryFailedResultSchema = z.object({
  /** Rows moved back to `pending`. */
  retried: z.number().int(),

  /**
   * Rows left `failed` because an active job already holds their dedup key.
   *
   * Not an error: a non-zero `skipped` means the work those rows describe is
   * already queued or running, which is the outcome the retry was asking for.
   * See `job-admin.service.ts` for why this is counted rather than thrown.
   */
  skipped: z.number().int(),

  /**
   * Failed rows still matching the scope after the sweep.
   *
   * Non-zero either because the batch cap was reached (run it again) or
   * because everything left was skipped. A client can decide which by
   * comparing against `skipped`.
   */
  remaining: z.number().int(),
});

/**
 * The result of `POST /api/admin/jobs/reset-stuck`.
 *
 * @stability experimental
 */
export const resetStuckResultSchema = z.object({
  /** Rows requeued as `pending` for another executor to claim. */
  reset: z.number().int(),
  /** Rows failed permanently because their attempt budget was spent. */
  failed: z.number().int(),
  /** The threshold actually applied, whether it came from the body or settings. */
  thresholdMinutes: z.number().int(),
});
