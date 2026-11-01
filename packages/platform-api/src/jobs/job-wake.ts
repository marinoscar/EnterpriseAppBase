// =============================================================================
// `jobs.enqueued` — the idle-worker wake-up (PP-1.11, issue #682)
// =============================================================================
//
// `JobsService.enqueue` publishes this on the event bus after it INSERTs a job
// that is due now; every `JobWorker` whose eligible types include `type`
// resolves its idle poll sleeps early and claims. With
// `EVENT_BUS_ADAPTER=postgres` that includes workers on other replicas.
//
// LATENCY ONLY, NEVER CORRECTNESS. The bus is at most once, so a wake-up can
// be lost (a listener reconnecting, an `enqueueWithin` that deliberately does
// not publish). The `JOBS_POLL_MS` poll is what guarantees every job is
// eventually claimed; this only removes the wait in the common case. Many
// slots waking for one job is safe: the claim is `FOR UPDATE SKIP LOCKED`, so
// one wins and the rest find nothing and go back to sleep.
//
// The payload carries the type and nothing else — never the job's payload,
// which may hold user data (and the bus must never carry a secret).
// =============================================================================

/**
 * The event-bus channel an enqueue announces itself on (`{ type }` only), so
 * an idle worker on any replica claims at once instead of on its next poll.
 *
 * @stability experimental
 */
export const JOBS_ENQUEUED_CHANNEL = 'jobs.enqueued';

export interface JobsEnqueuedMessage {
  type: string;
}

export function isJobsEnqueuedMessage(value: unknown): value is JobsEnqueuedMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type !== ''
  );
}
