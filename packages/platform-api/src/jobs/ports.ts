// =============================================================================
// The jobs slice's host ports (issue #734, PP-8.2)
// =============================================================================
//
// Every capability the queue needs from the application, as ONE injection
// token per capability. The slice injects these and never imports an app
// service; the app binds each token in a `@Global()` module of its own (the
// reference app: `apps/api/src/platform/jobs/jobs-host.module.ts`), passed to
// `JobsModule.forRoot({ imports })`. Each interface is derived from the exact
// calls the queue makes; nothing wider.
//
// The database is the core port `PLATFORM_PRISMA`, seen as `JobsPrisma`
// (`data/jobs-db.ts`). Every port here is OPTIONAL: without it the queue still
// runs (no metrics, no cross-replica wake-up, no ambient organization).
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file agree.
// =============================================================================

// ---- metrics --------------------------------------------------------------------------

/**
 * Injection token of the app's {@link JobsMetrics}. Optional: without it the
 * queue records nothing.
 *
 * @example
 * ```ts
 * // JobsHostModule: { provide: JOBS_METRICS, useExisting: AppMetricsService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const JOBS_METRICS: unique symbol = Symbol.for('@marinoscar/platform/jobs/METRICS');

/**
 * The app's queue instruments (`app.jobs.*`), as the queue records into them.
 * The reference app binds its `AppMetricsService` (same instruments, same
 * labels as before the move: dashboards depend on them).
 *
 * ⚠ NO METHOD TAKES AN ORGANIZATION. `org.id` is a span attribute on job
 * spans, never a metric label (cardinality; spec, "Tenancy and access
 * model"). A recorder must not add one.
 *
 * @stability experimental
 */
export interface JobsMetrics {
  /**
   * A job row was inserted (not a dedup collapse onto an existing row).
   *
   * @param type - the job type.
   */
  jobEnqueued(type: string): void;
  /**
   * Jobs were claimed by one executor.
   *
   * @param executor - `'server'` or `'node'`.
   * @param types - the type of each claimed job, one entry per job.
   */
  jobsClaimedBy(executor: string, types: readonly string[]): void;
  /**
   * One executor report was settled.
   *
   * @param type - the job type.
   * @param outcome - a `JobSettleOutcome`.
   * @param durationMs - claim to settlement, or `null` when unknown.
   * @param executor - who ran it, when recorded.
   */
  jobSettled(type: string, outcome: string, durationMs: number | null, executor?: string | null): void;
  /**
   * The lease reaper recovered jobs.
   *
   * @param outcome - `'requeued'` or `'failed'`.
   * @param count - how many.
   * @param type - the job type, when known.
   */
  leaseReaped(outcome: 'requeued' | 'failed', count: number, type?: string): void;
}

/**
 * The metrics used when the app binds none: every call is a no-op.
 *
 * @stability experimental
 */
export const NOOP_JOBS_METRICS: JobsMetrics = Object.freeze({
  jobEnqueued: () => undefined,
  jobsClaimedBy: () => undefined,
  jobSettled: () => undefined,
  leaseReaped: () => undefined,
});

// ---- the wake-up bus --------------------------------------------------------------------

/**
 * Injection token of the app's cross-replica {@link JobsEventBus}. Optional:
 * without it idle workers find a new job on their next poll.
 *
 * @example
 * ```ts
 * // JobsHostModule: { provide: JOBS_EVENT_BUS, useExisting: EVENT_BUS }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const JOBS_EVENT_BUS: unique symbol = Symbol.for('@marinoscar/platform/jobs/EVENT_BUS');

/**
 * Where a bus message came from.
 *
 * @stability experimental
 */
export interface JobsEventBusMeta {
  /** The publishing process's origin id. */
  origin: string;
  /** Whether this process published it. */
  local: boolean;
}

/**
 * The app's event bus, as the queue uses it: one wake-up channel
 * (`jobs.enqueued`). The reference app binds its `EVENT_BUS`.
 *
 * @stability experimental
 */
export interface JobsEventBus {
  /**
   * Publishes a JSON payload on a channel. Never throws for a delivery
   * failure (the bus logs it).
   *
   * @param channel - the channel.
   * @param payload - the payload; small.
   */
  publish<T>(channel: string, payload: T): Promise<void>;
  /**
   * Subscribes to a channel; returns the unsubscribe function.
   *
   * @param channel - the channel.
   * @param handler - called once per message.
   */
  subscribe<T>(channel: string, handler: (payload: T, meta: JobsEventBusMeta) => void | Promise<void>): () => void;
}

// ---- the ambient organization -------------------------------------------------------------

/**
 * Injection token of the app's {@link JobsOrgScope}. Optional: without it a
 * job enqueued without an `orgId` is a system job (`org_id` null).
 *
 * @extensionPoint token
 * @stability experimental
 */
export const JOBS_ORG_SCOPE: unique symbol = Symbol.for('@marinoscar/platform/jobs/ORG_SCOPE');

/**
 * The organization the current unit of work runs for, when the app tracks
 * one ambiently (a request context). `JobsService.enqueue` asks it only when
 * the caller passed no `orgId` at all; an explicit `null` is never replaced.
 *
 * @stability experimental
 */
export interface JobsOrgScope {
  /** The current organization's id, or `null` outside any organization scope. */
  currentOrgId(): string | null;
}
