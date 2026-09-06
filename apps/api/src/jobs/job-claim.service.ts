// =============================================================================
// The atomic claim (issue #260, epic #254)
// =============================================================================
//
// ONE STATEMENT. That is the entire design, and everything else in this file
// exists to keep it one statement.
//
// `claim()` issues a single `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
// LOCKED …) RETURNING …`. The inner `SELECT` picks eligible rows and locks
// them, skipping any row another transaction already holds; the outer
// `UPDATE` marks exactly those rows `running` and hands them back. There is
// no window between "I chose this row" and "I own this row" in which a second
// claimer can choose it too, because there is no gap between the two — they
// are the same statement, in the same implicit transaction.
//
// This method is SHARED VERBATIM by both claimers in this epic: the
// in-process worker (#262) and, later, the node control plane (#268). That
// is why `ClaimOptions` carries `nodeId` and `executor` rather than the
// service knowing which side it is running on — a second copy of this query,
// specialised per caller, is exactly how the two would drift apart on the one
// statement that must not drift.
//
// -----------------------------------------------------------------------------
// WHY `FOR UPDATE SKIP LOCKED`, AND WHAT WAS REJECTED
// -----------------------------------------------------------------------------
//
// REJECTED: `SELECT … FOR UPDATE` followed by a separate `UPDATE`. Two
// statements, two round trips, a wider window in which the claiming process
// can die between them (leaving rows locked until the transaction unwinds),
// and no gain whatsoever — the second statement re-finds rows the first
// already identified. `SKIP LOCKED` plus `RETURNING` collapses both into one.
//
// REJECTED: an advisory lock (`pg_advisory_xact_lock`) around the claim. It
// works, and it serialises every claimer in the fleet through a single lock:
// with N workers, N-1 of them wait to do a query that takes microseconds. The
// whole point of `SKIP LOCKED` is that it is the primitive for "give me a row
// nobody else is working on" — it never blocks, it just steps over contended
// rows.
//
// REJECTED: an in-process mutex around claiming (which is what the source
// application this design was extracted from actually started with). It
// serialises claims WITHIN one process and is completely blind outside it,
// so it works perfectly on a laptop, works perfectly with one replica, and
// double-claims the moment a second replica is scheduled or a remote node
// joins. THIS IS THE BUG THIS DESIGN EXISTS TO AVOID: a correctness property
// that holds right up until the first time the system is scaled.
//
// -----------------------------------------------------------------------------
// ⚠ `attempts` IS CHARGED AT CLAIM TIME. IT MEANS "ATTEMPTS STARTED".
// -----------------------------------------------------------------------------
//
// `attempts = attempts + 1` is in the claim statement, not in any failure
// path, and this is a correctness decision rather than a convenience.
//
// A job can take the whole process down with it: an OOM kill, a hard crash, a
// container the orchestrator terminates mid-run. NONE of those reach a
// failure handler — there is no handler left to reach. So if `attempts` were
// charged when a job FAILS, such a job would be requeued with its budget
// untouched, claimed again, kill the process again, and crash-loop the
// container for as long as anyone lets it. The retry budget would be
// unreachable by exactly the failures it most needs to bound.
//
// Charging at claim makes the counter mean "attempts STARTED", which is the
// only thing observable from outside a process that may not survive. It is
// what lets the lease reaper (#263) find a job whose lease expired with its
// budget spent and mark it permanently `failed` — bounding a poison pill to
// N crashes instead of infinity.
//
// The cost is honest and small: a job whose worker was killed for reasons of
// its own (a deploy, a node drain) is charged an attempt it did not deserve.
// A retry budget losing one of N on a redeploy is a far better failure than
// an unbounded crash loop.
//
// TWO CONSEQUENCES THAT LIVE ELSEWHERE, recorded here so neither gets
// rediscovered as a bug:
//
//   - The rate-limit deferral path (#261) explicitly UN-CHARGES this
//     increment. A provider throttling us is not an attempt at the work, and
//     a job merely waiting its turn must not exhaust a budget meant for a job
//     that keeps failing. That is also why `rateLimitHits` is a separate
//     counter — see the `Job` model's block comment in `schema.prisma`.
//   - `attempts` is already 1 by the time a handler's `process()` runs. Any
//     code reading it inside a handler is reading the count INCLUDING the
//     current attempt, never excluding it.
//
// -----------------------------------------------------------------------------
// EVERY `RETURNING` COLUMN IS ALIASED TO ITS camelCase PRISMA FIELD
// -----------------------------------------------------------------------------
//
// The table is snake_case; the generated `Job` type is camelCase. Aliasing
// every column in `RETURNING` means the rows Postgres hands back ARE `Job`
// values — no mapping function between the query and its callers, and
// therefore no mapping function to forget a field in.
//
// ⚠ `ORDER BY` SELECTS *WHICH* ROWS, NOT THE ORDER THEY COME BACK IN. The
// `ORDER BY priority ASC, created_at ASC` lives in the inner `SELECT`, where
// it decides which rows the claim takes — the most urgent, oldest-first. SQL
// gives `UPDATE … RETURNING` no ordering guarantee at all, so the returned
// array is a SET, not a sequence, and Postgres is free to hand it back in any
// order. A caller that needs the rows sorted must sort them; nothing in this
// epic does, because a worker dispatches each claimed job independently. Do
// not "fix" this by adding an outer `ORDER BY` — `UPDATE` has no such clause,
// and wrapping the statement to get one would trade the single-statement
// atomicity this whole file exists for against an ordering nobody needs.
//
// The alias list is derived from `JOB_CLAIM_COLUMNS` below rather than typed
// out inline, which is what turns a schema change into a COMPILE error: that
// map is typed `Record<keyof Job, string>`, so adding a column to `Job`
// fails to compile until the map covers it, and renaming one fails to compile
// on the stale key. Written out by hand instead, the same rename would
// produce a row missing a field, silently `undefined` at every call site —
// the failure would surface as a null-ish value somewhere downstream rather
// than at the line that caused it. `job-model-fields.spec.ts` locks the same
// pairing down from the test side.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Job, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Which side of the system is executing a claimed job. Written to
 * `jobs.executor` so history records where the work actually ran.
 */
export type JobExecutor = 'server' | 'node';

export interface ClaimOptions {
  /**
   * The worker node taking the rows, or `null` for the API server's own
   * in-process worker.
   *
   * Typed `string | null` and cast to `uuid` in the statement: the column is
   * `@db.Uuid`, and there is no FK to a node table yet (the `Job` model's
   * comment explains why, and what arrives with the node plane).
   */
  nodeId: string | null;

  /** What to write to `jobs.executor`. */
  executor: JobExecutor;

  /**
   * The job types this claimer is allowed to run.
   *
   * ALWAYS an explicit list, never "everything". The in-process worker passes
   * the registry's `types()` in `all` mode and `serverOnlyTypes()` in
   * `system` mode (#262); the node plane passes what a node can run (#268).
   * A claimer must never take a job it has no handler for — that would turn
   * a perfectly good job into an "unknown job type" permanent failure.
   */
  eligibleTypes: string[];

  /** Maximum rows to claim in this call. */
  limit: number;

  /**
   * How long the claim is good for, in milliseconds. Written as
   * `lease_expires_at = now() + leaseMs`, and it is what the lease reaper
   * (#263) reads to find jobs whose claimer died holding them.
   */
  leaseMs: number;
}

/**
 * Every `Job` field mapped to the physical column it is stored in.
 *
 * TYPED `Record<keyof Job, string>` ON PURPOSE — see the file header. This is
 * the compile-time half of "the claim's `RETURNING` clause cannot drift from
 * the schema"; `job-model-fields.spec.ts` is the runtime half.
 */
export const JOB_CLAIM_COLUMNS: Readonly<Record<keyof Job, string>> = {
  id: 'id',
  type: 'type',
  subjectType: 'subject_type',
  subjectId: 'subject_id',
  dedupKey: 'dedup_key',
  status: 'status',
  reason: 'reason',
  priority: 'priority',
  providerKey: 'provider_key',
  modelVersion: 'model_version',
  payload: 'payload',
  attempts: 'attempts',
  lastError: 'last_error',
  createdAt: 'created_at',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  scheduledFor: 'scheduled_for',
  rateLimitedAt: 'rate_limited_at',
  rateLimitHits: 'rate_limit_hits',
  claimedByNodeId: 'claimed_by_node_id',
  leaseExpiresAt: 'lease_expires_at',
  executor: 'executor',
};

/**
 * The `RETURNING` list: `created_at AS "createdAt", …` for every field above.
 *
 * `Prisma.raw` is used because a column list is SQL structure, not a value,
 * and structure cannot be parameterised. It is safe here for a reason that
 * has nothing to do with trust in the caller: the ONLY input is the
 * module-level constant above, evaluated once at import time, with no path
 * from any request, argument or environment variable to this string. Every
 * genuine value in `claim()` below goes through a real placeholder.
 */
const CLAIM_RETURNING = Prisma.raw(
  Object.entries(JOB_CLAIM_COLUMNS)
    .map(([field, column]) => `${column} AS "${field}"`)
    .join(', ')
);

@Injectable()
export class JobClaimService {
  private readonly logger = new Logger(JobClaimService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically takes up to `limit` runnable jobs and marks them `running`.
   *
   * Returns the claimed rows as generated `Job` values, already carrying
   * `attempts` incremented, `startedAt` set, and the lease applied. An empty
   * array means "nothing to do right now", which is the overwhelmingly common
   * answer and is not an error.
   *
   * ⚠ THE RETURNED ARRAY IS UNORDERED. `ORDER BY priority ASC, created_at
   * ASC` decides *which* rows are taken; `RETURNING` promises nothing about
   * the order they arrive in. Sort at the call site if it matters.
   *
   * MULTI-PROCESS SAFE. Two claimers running concurrently — two replicas, a
   * replica and a node, two threads of the same pool — never receive the same
   * row. See the file header for the mechanism and for the three alternatives
   * that are not safe.
   */
  async claim(options: ClaimOptions): Promise<Job[]> {
    const { nodeId, executor, eligibleTypes, limit, leaseMs } = options;

    // SHORT-CIRCUIT, NOT A ROUND TRIP. Both of these are ordinary states, not
    // misconfigurations: a worker in `system` mode with no server-only
    // handlers registered has an empty `eligibleTypes`, and a pool with every
    // slot busy asks for a `limit` of 0. The query would correctly return no
    // rows in both cases — `type = ANY('{}')` matches nothing, `LIMIT 0`
    // returns nothing — so this is purely about not paying for a database
    // round trip on every poll tick to be told what is already known here.
    if (eligibleTypes.length === 0 || limit <= 0) {
      return [];
    }

    // ONE STATEMENT. Do not split this into a SELECT and an UPDATE; the file
    // header explains why the atomicity lives in the fact that it is one.
    //
    // Every value below is a real bound parameter (`Prisma.sql`'s tagged
    // template turns each `${}` into a placeholder) — nothing is interpolated
    // into the SQL text. The explicit casts are there because a placeholder
    // carries no type of its own: `::"JobStatus"` for the enum comparisons,
    // `::uuid` for the nullable node id, `::text[]` for the type list, and
    // `::double precision` for the lease so the multiplication against
    // `interval '1 millisecond'` resolves regardless of how the driver sends
    // the number.
    const rows = await this.prisma.$queryRaw<Job[]>(Prisma.sql`
      UPDATE jobs SET
        status = 'running'::"JobStatus",
        started_at = now(),
        scheduled_for = NULL,
        attempts = attempts + 1,
        claimed_by_node_id = ${nodeId}::uuid,
        executor = ${executor},
        lease_expires_at = now() + (${leaseMs}::double precision * interval '1 millisecond')
      WHERE id IN (
        SELECT id FROM jobs
        WHERE status = 'pending'::"JobStatus"
          AND (scheduled_for IS NULL OR scheduled_for <= now())
          AND type = ANY(${eligibleTypes}::text[])
        ORDER BY priority ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING ${CLAIM_RETURNING}
    `);

    if (rows.length > 0) {
      this.logger.debug(
        `Claimed ${rows.length} job(s) as ${executor}` +
          `${nodeId ? ` (node ${nodeId})` : ''}: ` +
          rows.map((row) => `${row.id} (${row.type})`).join(', ')
      );
    }

    return rows;
  }
}
