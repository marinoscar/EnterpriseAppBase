// =============================================================================
// The lease reaper's three primitives (issue #263, epic #254)
// =============================================================================
//
// A job whose executor died is `running` forever. Nothing else in the queue
// can notice: the worker that held it is gone, so there is nobody left to
// write the terminal row, and the slot it occupied is only freed inside a
// process that no longer exists. The row itself looks exactly like a job that
// is going perfectly well — same status, same claim, same `attempts` — and
// the ONLY thing that distinguishes the two is time.
//
// This file is what turns "time" into a decision, and it is deliberately
// three separate pieces:
//
//   - `getStuckThresholdMinutes()` — how long is too long, from settings.
//   - `stuckRunningWhere()`        — which rows are stuck, as a `where`.
//   - `resetStuck()`               — what to do about them.
//
// -----------------------------------------------------------------------------
// WHY THESE LIVE HERE AND NOT IN AN ADMIN SERVICE
// -----------------------------------------------------------------------------
//
// The obvious home for "reset the stuck jobs" is the admin jobs service — a
// human clicking a button in a dashboard is the caller you think of first,
// and the endpoint has to exist anyway. Putting them there would be wrong,
// and the reason is a deployment rather than a taste:
//
//     JOBS_WORKER_MODE=off + an external node fleet
//
// That is an API server acting as a PURE CONTROL PLANE. It claims nothing and
// runs nothing; every job executes on a machine it does not own. It is also
// the deployment where dead leases are most likely by a wide margin — a
// laptop closing its lid, a spot instance reclaimed, a node process killed by
// its own OOM killer are all NORMAL events in a fleet, not edge cases. If the
// reaper could only reach these primitives through the admin service, then
// reaping would be coupled to the admin surface being mounted and reachable,
// and the one deployment that needs it most would be the one least likely to
// have it.
//
// So the dependency points the other way round, permanently: the reaper task
// and (later) the admin endpoint both depend on THIS service, and this
// service depends on nothing but Prisma, config and settings. Reaping is a
// CONTROL-PLANE DUTY, not a worker duty — which is also why the task that
// drives it honours `JOBS_REAPER_ENABLED` and never looks at
// `JOBS_WORKER_MODE`.
//
// -----------------------------------------------------------------------------
// THE GIVE-UP PHASE ONLY WORKS BECAUSE `attempts` IS CHARGED AT CLAIM TIME
// -----------------------------------------------------------------------------
//
// `resetStuck` has two phases, and the second one (fail the rows that have
// spent their budget) is the whole reason a poison pill is bounded rather
// than eternal. A job that reliably kills its executor — an OOM, a segfault
// in a native dependency, a `process.exit()` in a library — never reaches
// `JobTerminalService` at all, so nothing on the terminal path can ever count
// it. If the reaper simply requeued it, the sequence would be:
//
//     claim → executor dies → reaped → claim → executor dies → …
//
// forever, at one crash per stuck threshold, with the container restarting
// under it each time. The ONLY reason this loop terminates is that
// `job-claim.service.ts` increments `attempts` in the claiming UPDATE itself
// (§4.5 of docs/specs/job-queue.md: `attempts` means "attempts STARTED", not
// "attempts that reported back"). The count therefore survives the death of
// the process that was running the job, and after `JOBS_MAX_ATTEMPTS` deaths
// the reaper can say "this has had its budget" with evidence.
//
// Charge `attempts` on failure instead and this phase becomes unimplementable
// — there is nothing to compare against — which is why that decision and this
// one are the same decision seen from two ends.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { DEFAULT_SYSTEM_SETTINGS } from '../common/types/settings.types';
import { PrismaService } from '../prisma/prisma.service';
import { SystemSettingsService } from '../settings/system-settings/system-settings.service';

/** What `resetStuck` did, split by which phase claimed each row. */
export interface ResetStuckResult {
  /** Rows put back to `pending` for another executor to claim. */
  reset: number;

  /** Rows that had spent their attempt budget and were marked `failed`. */
  failed: number;
}

/**
 * The `where` that identifies an abandoned `running` job, as THREE OR'd
 * recovery signals.
 *
 * All three are real, and each one is the only signal that catches its own
 * failure mode. Dropping any of them leaves a class of dead row unreapable:
 *
 *   1. `startedAt < threshold` — THE AGED CLAIM. The ordinary case: a job
 *      that was properly stamped when it was claimed and has been running
 *      longer than any job of any type should. This is the signal that works
 *      even when `lease_expires_at` was never written (a fork's own claim
 *      path, a row hand-inserted by an operator, a migration that pre-dates
 *      leases).
 *
 *   2. `startedAt IS NULL AND createdAt < threshold` — THE ZOMBIE. A row that
 *      is `running` and has no start time at all. It looks impossible,
 *      because the claim writes `started_at = now()` in the same statement
 *      that writes `status = 'running'` — and it is exactly the state a
 *      partially-applied write, a restored backup, or an external control
 *      plane setting the status without the timestamp leaves behind. Signal
 *      1 cannot see it (`NULL < threshold` is NULL, never true) and neither
 *      can signal 3 if the lease was not written either, so without this
 *      clause such a row is stuck FOREVER and its dedup key is held forever
 *      with it. `createdAt` is the substitute age, and it is always present.
 *
 *   3. `leaseExpiresAt < now` — THE DEAD OWNER. The fastest and most precise
 *      signal, and the only one that does not have to wait out the stuck
 *      threshold: whoever claimed this row promised to renew or settle it
 *      before this instant, and did not. It covers a server replica killed
 *      mid-job and a remote node that went away — the lid-closing laptop —
 *      identically, because the lease says nothing about WHERE the executor
 *      was.
 *
 * ⚠ THE COMPARISONS USE TWO DIFFERENT INSTANTS ON PURPOSE. Signals 1 and 2
 * are "older than the threshold"; signal 3 is "past its deadline, now". A
 * single instant for both would either reap live jobs (using `now` for the
 * age) or leave an expired lease sitting for another whole threshold (using
 * `threshold` for the deadline). Both are passed in rather than read from the
 * clock inside, so every row in one sweep is judged against the same pair of
 * instants and a test can pin them.
 *
 * Exported as a pure function, not a private method, for the reason the file
 * header gives: the admin surface, the reaper and any later node-plane
 * sweeper must ask the same question, and the only way to guarantee that is
 * for there to be one copy of it.
 */
export function stuckRunningWhere(threshold: Date, now: Date): Prisma.JobWhereInput {
  return {
    status: 'running',
    OR: [
      // 1. Aged: claimed and stamped, running too long.
      { startedAt: { lt: threshold } },
      // 2. Zombie: claimed, never stamped — aged by `createdAt` instead.
      { startedAt: null, createdAt: { lt: threshold } },
      // 3. Dead owner: the lease its claimer took has run out (server OR node).
      { leaseExpiresAt: { lt: now } },
    ],
  };
}

@Injectable()
export class JobStuckService {
  private readonly logger = new Logger(JobStuckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly systemSettings: SystemSettingsService
  ) {}

  /**
   * How long a `running` job may go without progress before it is treated as
   * abandoned, from the `jobs.stuckThresholdMinutes` system setting.
   *
   * READ THROUGH THE NARROW SETTINGS ACCESSOR (`getJobsPolicy`), not with a
   * `system_settings` query of its own: the accessor projects one column, does
   * not create the row, and is the single read path for this value — see its
   * doc comment. A second read path here is how "the reaper uses a different
   * threshold than the dashboard shows" starts.
   *
   * NEVER THROWS. This is called from a cron tick with no caller to report to,
   * and a settings read that failed is not a reason to stop reaping — it is a
   * reason to reap on the shipped default, loudly. The fallback is
   * `DEFAULT_SYSTEM_SETTINGS.jobs.stuckThresholdMinutes` rather than a literal,
   * so there is still exactly one place the number lives.
   */
  async getStuckThresholdMinutes(): Promise<number> {
    try {
      const policy = await this.systemSettings.getJobsPolicy();
      const minutes = policy.stuckThresholdMinutes;

      if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) {
        return minutes;
      }
    } catch (error) {
      this.logger.warn(
        `Could not read jobs.stuckThresholdMinutes; falling back to ` +
          `${DEFAULT_SYSTEM_SETTINGS.jobs.stuckThresholdMinutes} minutes: ${describe(error)}`
      );
    }

    return DEFAULT_SYSTEM_SETTINGS.jobs.stuckThresholdMinutes;
  }

  /**
   * Reclaims every abandoned `running` job, in TWO PHASES.
   *
   * PHASE 1 — GIVE UP. Rows at or over `JOBS_MAX_ATTEMPTS` are marked
   * `failed`. These have already been started that many times and have killed
   * their executor every time; another requeue buys nothing but another crash.
   * See the file header for why this phase is only implementable at all.
   *
   * Done ONE ROW AT A TIME, deliberately, and not as a single `updateMany`.
   * The message written to `lastError` names THAT job's own attempt count
   * ("after 3 attempt(s)"), which is the number a human needs to tell an
   * unlucky job from a poison pill, and a bulk update can only write one
   * string for every row it touches. The phase is bounded by how many jobs
   * exhausted their budget while nobody was watching — a handful, in any
   * healthy deployment — so N small updates is the right trade for a message
   * that is actually true.
   *
   * PHASE 2 — REQUEUE. Rows still under budget go back to `pending` with the
   * claim, the lease and the executor released, so any worker (this server,
   * another replica, a node) may take them. One `updateMany`, because every
   * row gets the same treatment and the same message.
   *
   * `attempts` IS NOT TOUCHED BY EITHER PHASE. It was charged at claim time
   * and the attempt genuinely happened — the executor started the work and
   * died doing it. Un-charging it here (as the rate-limit deferral in
   * `JobTerminalService` deliberately does) would erase the only evidence a
   * poison pill leaves behind and make phase 1 unreachable.
   *
   * @param olderThanMinutes override for the configured threshold — what an
   * operator passes from an admin "reset jobs stuck for more than N minutes"
   * control. Omitted, the system setting decides.
   */
  async resetStuck(olderThanMinutes?: number): Promise<ResetStuckResult> {
    const minutes =
      typeof olderThanMinutes === 'number' && Number.isFinite(olderThanMinutes)
        ? Math.max(0, olderThanMinutes)
        : await this.getStuckThresholdMinutes();

    // ONE `now` for the whole sweep. Reading the clock per phase would let a
    // row that is stuck by the lease signal fall between the two queries, and
    // makes the phases untestable without freezing timers.
    const now = new Date();
    const threshold = new Date(now.getTime() - minutes * 60_000);
    const where = stuckRunningWhere(threshold, now);

    const maxAttempts = this.configNumber('jobs.maxAttempts', 3);

    // ---- Phase 1: the rows that have spent their budget -------------------
    const exhausted = await this.prisma.job.findMany({
      where: { ...where, attempts: { gte: maxAttempts } },
      select: { id: true, type: true, attempts: true },
    });

    let failed = 0;

    for (const row of exhausted) {
      // The `where` is re-applied alongside the id rather than updating by id
      // alone: between the read above and this write the job may have been
      // settled by an executor that was alive after all (a long GC pause, a
      // network partition that healed). Re-asserting "still stuck" makes the
      // update a no-op in that case instead of stamping `failed` over a
      // perfectly good `succeeded`.
      const result = await this.prisma.job.updateMany({
        where: { ...where, id: row.id },
        data: {
          status: 'failed',
          finishedAt: now,
          lastError:
            `Abandoned by its executor and reclaimed by the lease reaper ` +
            `after ${row.attempts} attempt(s); the attempt budget ` +
            `(${maxAttempts}) is spent, so it will not be retried.`,
          scheduledFor: null,
          // A terminal row must not appear to be held by anybody. `executor`
          // is deliberately KEPT — which side the job died on is exactly the
          // thing you want to still know later — matching
          // `JobTerminalService.failPermanently`.
          claimedByNodeId: null,
          leaseExpiresAt: null,
        },
      });

      failed += result.count;

      if (result.count > 0) {
        this.logger.warn(
          `Job ${row.id} (${row.type}) was abandoned by its executor on all ` +
            `${row.attempts} of its attempts; failing it permanently rather than requeueing.`
        );
      }
    }

    // ---- Phase 2: the rows that still have budget -------------------------
    //
    // The same `where` and the same `now`, so a row can match exactly one
    // phase: phase 1 took `attempts >= maxAttempts`, this takes the rest.
    const requeued = await this.prisma.job.updateMany({
      where: { ...where, attempts: { lt: maxAttempts } },
      data: {
        status: 'pending',
        // Release every live ownership assertion. `executor` IS cleared here,
        // unlike on the terminal path: this row is going to be claimed again,
        // possibly by the other side entirely, and a stale "node" on a job the
        // server is about to run is a lie rather than history.
        claimedByNodeId: null,
        leaseExpiresAt: null,
        executor: null,
        // Eligible immediately — the job has already waited out the whole
        // stuck threshold, which is longer than any retry backoff would be.
        scheduledFor: null,
        finishedAt: null,
        lastError:
          'Abandoned by its executor and requeued by the lease reaper. ' +
          'Its attempt was already charged at claim time.',
        // `startedAt` is left as it was: the next claim overwrites it, and
        // until then it records when the run that died began.
      },
    });

    if (requeued.count > 0 || failed > 0) {
      this.logger.log(
        `Lease reaper: ${requeued.count} job(s) requeued, ${failed} failed ` +
          `permanently (stuck threshold ${minutes} minute(s)).`
      );
    }

    return { reset: requeued.count, failed };
  }

  /**
   * A numeric setting with a defensive fallback, the same shape (and for the
   * same reason) as `JobTerminalService.configNumber`: this service is also
   * constructed directly in unit tests with a stub `ConfigService`, and a
   * missing key must degrade to the shipped behaviour rather than to `NaN` —
   * which would make every `attempts` comparison below false and silently turn
   * the give-up phase off.
   */
  private configNumber(key: string, fallback: number): number {
    const value = this.config.get<number>(key);

    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }
}

/** Whatever was thrown, rendered for a log line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
