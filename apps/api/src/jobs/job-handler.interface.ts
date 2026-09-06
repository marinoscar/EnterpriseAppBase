// =============================================================================
// Job handler contract (issue #259, epic #254)
// =============================================================================
//
// THE EXTENSION POINT OF THE WHOLE QUEUE, and deliberately the smallest thing
// that can be one. Epic #254's headline promise is that a fork adds a new
// background job type with ONE class and no queue wiring: no migration (the
// `jobs` table stores `type` as a plain string precisely so a new handler
// costs zero schema change — see the `Job` model's own comment in
// prisma/schema.prisma), no enum arm, no `switch` in a worker, no entry in a
// central dispatch table. That promise is only true if the worker's entire
// knowledge of a job type is "ask the registry for a handler with this
// `type`, call `process`" — which is what the interface below is, and why it
// has exactly two required members.
//
// The same argument `notification-events.ts` makes for notifications and
// `object-processor.interface.ts` makes for post-upload processing, applied
// to background work: the framework owns the mechanism, the feature owns one
// class, and neither has to edit the other.
//
// -----------------------------------------------------------------------------
// `process` THROWS TO FAIL — IT DOES NOT RETURN A RESULT OBJECT
// -----------------------------------------------------------------------------
//
// `Promise<void>` and "throw to fail" rather than
// `ObjectProcessor`-style `Promise<{ success, error }>`. The two contracts
// look similar and are answering different questions, so the difference is
// deliberate:
//
//   - An object processor is one of SEVERAL processors run in sequence over
//     the same upload, and one failing must not abort the others. It needs to
//     report a per-processor outcome that the pipeline aggregates into
//     metadata, so a result object is right there.
//   - A job handler IS the job. There is nothing to aggregate: the job either
//     completed or it did not, and "did not" must be visible to the retry
//     machinery (#263) as `attempts`, `lastError` and a `failed` status.
//
// A returned `{ success: false }` would have to be converted into a throw
// somewhere anyway, and a handler that forgot to check an inner promise would
// return `{ success: true }` for work that never happened. Throwing is the
// default failure mode of every async call a handler makes — an unawaited-but-
// awaited rejection, a database error, a fetch timeout — so "throw to fail"
// means a handler gets correct failure behaviour by writing NO error handling
// at all. Swallowing an error is then the visible, deliberate act (a
// `try/catch` in the handler that does not rethrow), which is the right way
// round: a job that silently reports success is far worse than one that
// retries something it did not need to.
//
// The message on the thrown error is what lands in `Job.lastError`, so throw
// something a human reading the admin job list can act on.
//
// -----------------------------------------------------------------------------
// NODE ELIGIBILITY: THE OPTIONAL PAIR *IS* THE MECHANISM
// -----------------------------------------------------------------------------
//
// Later in this epic, work can be computed on a remote worker node instead of
// on the API server: the node receives a claimed job, does the expensive part
// with no database access of its own, and POSTs a result back for the server
// to persist. Not every job type can work that way — a handler that reads
// three tables mid-computation, or that streams a file out of object storage,
// or that writes as it goes, is server-only by nature.
//
// The system's ONE source of truth for that distinction is the presence of
// the two optional members below:
//
//   - A handler carrying BOTH `nodeResultSchema` and `persistNodeResult` is
//     NODE-ELIGIBLE: its work can be computed remotely (the schema is how the
//     server validates the untrusted payload a node posts back) and its
//     result can then be written down (that is what `persistNodeResult` does).
//   - A handler carrying NEITHER is SERVER-ONLY. This is the default, and it
//     is what every handler is until someone deliberately adds both members.
//   - A handler carrying exactly ONE of the two is SERVER-ONLY, not a
//     half-eligible special case. A schema with no persist function describes
//     a payload nobody can store; a persist function with no schema would have
//     to trust an unvalidated body from a remote machine. Neither is a state
//     the node plane can safely act on, so both collapse to the safe answer.
//     `JobHandlerRegistry.serverOnlyTypes()` derives exactly this, and it is
//     what makes the later `system` worker mode ("run everything that CANNOT
//     go to a node") possible with no second list to maintain.
//
// REJECTED: a `readonly nodeEligible: boolean` flag alongside the members.
// A flag is a second statement of a fact the members already state, so it can
// disagree with them — `nodeEligible: true` on a handler with no
// `persistNodeResult` is a job dispatched to a node whose result the server
// then cannot store, and the failure surfaces on a remote machine at runtime
// rather than in review. Deriving eligibility from the members makes that
// wrong state unrepresentable: there is nothing to set inconsistently. See
// docs/specs/job-queue.md for the full argument.
//
// -----------------------------------------------------------------------------
// `persistNodeResult` DOES THE PERSIST HALF AND NOTHING ELSE
// -----------------------------------------------------------------------------
//
// This is a hard rule, not a style preference, and it is what keeps a remote
// node from needing database access. The split is:
//
//     node   →  compute the result  (no DB, no secrets, no app tables)
//     server →  validate it against `nodeResultSchema`, then
//               `persistNodeResult` writes it down
//
// So `persistNodeResult` MUST NOT recompute the work, re-download the input,
// call the provider again, or "fix up" a result it dislikes. It takes the
// already-validated value and writes it. The moment it does any of the other
// things, the node's computation stops being the source of the result — the
// server is doing the work twice, the node's answer is decorative, and the
// whole reason for the node plane (expensive work off the API server) is
// gone. If a result cannot be persisted without recomputation, the type is
// not node-eligible: drop both members and let it run server-side.
//
// The `result: unknown` parameter type is deliberate: `notify()`'s `data:
// unknown` makes the same trade. The value arrives from off-machine, so it is
// untrusted by construction, and `nodeResultSchema` is the only thing that
// may narrow it. Parse, then use the parse's output type.
// =============================================================================

import { Job } from '@prisma/client';
import type { z } from 'zod';

/**
 * DI token for job handlers.
 *
 * Present for symmetry with `OBJECT_PROCESSOR` and
 * `NOTIFICATION_CHANNEL_SENDERS`, and so a fork that prefers to collect
 * handlers with a `multi`-style provider array has a token to collect them
 * under. Note that the registration path this epic actually uses is
 * SELF-REGISTRATION from each handler's own `OnModuleInit` — see
 * `job-handler.registry.ts` for why, and `handlers/README.md` for the recipe.
 */
export const JOB_HANDLER = Symbol('JOB_HANDLER');

export interface JobHandler {
  /**
   * The `Job.type` value this handler is responsible for.
   *
   * The registry keys on this string and the worker dispatches on it, so it
   * must be unique across every handler in the process — a duplicate
   * overwrites, loudly (see `JobHandlerRegistry.register`). Use a dotted,
   * lowercase, product-neutral key (`'email.send'`, `'export.csv'`), and
   * treat it as PERMANENT once jobs of that type exist: rows outlive the
   * handler that produced them, and renaming the key orphans every historical
   * row and every pending job already queued under the old name.
   */
  readonly type: string;

  /**
   * Runs the job.
   *
   * THROW TO FAIL — the worker turns a rejection into `Job.lastError` plus a
   * retry (or a terminal `failed` status once the attempt budget is spent).
   * Returning normally means the work is done and durable; do not return
   * before the writes this job is responsible for have committed.
   *
   * Should be IDEMPOTENT wherever the underlying operation allows it. A job
   * can legitimately run more than once: a retry after a partial failure, or
   * a lease that expired because the executing process was killed mid-run and
   * another worker reclaimed it. The queue guarantees at-least-once, never
   * exactly-once.
   */
  process(job: Job): Promise<void>;

  /**
   * Validates the result a remote worker node posts back for this job type.
   *
   * PRESENT ONLY ON NODE-ELIGIBLE HANDLERS, and only ever together with
   * `persistNodeResult` — see the file header: both members or neither, and
   * exactly one of the two means server-only.
   *
   * The value it parses arrives from a machine the API server does not
   * control, so this schema is a trust boundary, not a convenience: it is the
   * only thing standing between an arbitrary remote body and
   * `persistNodeResult`'s writes.
   */
  readonly nodeResultSchema?: z.ZodType;

  /**
   * Writes down a node-computed result that `nodeResultSchema` has already
   * validated.
   *
   * PRESENT ONLY ON NODE-ELIGIBLE HANDLERS (see `nodeResultSchema`).
   *
   * PERSIST ONLY. No recomputation, no re-downloading the input, no second
   * call to whatever provider the node used — the file header explains why
   * that rule is what keeps a node from needing database access at all. If
   * this method cannot do its job without redoing the work, the type is not
   * node-eligible.
   *
   * Throwing here fails the job exactly as throwing from `process` does.
   */
  persistNodeResult?(job: Job, result: unknown): Promise<void>;
}
