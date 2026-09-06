// =============================================================================
// The in-process worker pool (issue #262, epic #254)
// =============================================================================
//
// The first thing in this epic that RUNS ON ITS OWN. #259 gave the queue a
// handler contract and a registry, #260 gave it enqueue and the atomic claim,
// #261 gave it the terminal chokepoint — and none of the three ever ticks.
// This file is the tick: N independent slot loops, each claiming ONE job,
// running it, and going round again.
//
// It writes NOTHING to the `jobs` table itself. Every row it touches is
// touched through `JobClaimService.claim` on the way in and
// `JobTerminalService.completeSucceeded` / `completeFailed` on the way out.
// That is not tidiness — it is the whole point of #261's chokepoint: the node
// control plane (#268) will reach the same two methods from the other side,
// and the two executors can only agree about a finished job by calling the
// same code.
//
// -----------------------------------------------------------------------------
// ⚠ IT STARTS FROM `onApplicationBootstrap`, NOT `onModuleInit`
// -----------------------------------------------------------------------------
//
// This is a CORRECTNESS CONSTRAINT, not a preference, and it is stated from
// the other side in `job-handler.registry.ts` (see its "THE LIFECYCLE
// CONSEQUENCE THE WORKER (#262) MUST RESPECT" block) and in §1.3 of
// docs/specs/job-queue.md. The three say the same thing on purpose: the file
// that creates the hazard, the file that must respect it, and the document
// that records why.
//
// Handlers self-register from their OWN `onModuleInit`
// (`registry.register(this)`). Nest runs every `onModuleInit` hook in one
// phase, in module-resolution order, and only afterwards runs every
// `onApplicationBootstrap` hook. A worker that began polling from
// `onModuleInit` would therefore be racing the registrations it depends on:
// whether `registry.get(type)` finds a handler would come down to which
// module Nest happened to initialise first, and on a slow boot — a handler
// whose `onModuleInit` awaits anything at all — the worker would claim a job
// whose handler has not registered yet.
//
// And that failure is NOT a retryable blip. A claimed job with no registered
// handler is failed PERMANENTLY (see `runJob` below, and the reason it must
// be permanent), so the cost of losing this race is a perfectly good job
// destroyed for a reason that had gone away one second later. This is a real
// production bug in the application this design was extracted from. Starting
// at `onApplicationBootstrap` turns the ordering from luck into a guarantee.
//
// -----------------------------------------------------------------------------
// INDEPENDENT SLOT LOOPS, NOT ONE LOOP CLAIMING A BATCH OF N
// -----------------------------------------------------------------------------
//
// The obvious shape is one loop that claims `limit: N` and `Promise.all`s the
// results. REJECTED, because that is a BATCH BARRIER: the loop cannot claim
// again until its SLOWEST member finishes, so with mixed durations — which is
// every real queue — effective concurrency collapses toward 1. Nine
// hundred-millisecond jobs batched with one ten-minute job means eight idle
// slots for ten minutes while the queue backs up.
//
// N independent loops have no barrier. A slow job stalls exactly one slot,
// which is the honest cost of running it, and the other N-1 keep claiming.
// The price is N concurrent single-row claims instead of one N-row claim, and
// that price is nothing: `FOR UPDATE SKIP LOCKED` is designed for exactly
// this access pattern and never blocks — two loops racing for one row have
// one winner and one `[]`, with no waiting on either side (§4.4).
//
// -----------------------------------------------------------------------------
// WHAT A SLOT DOES, IN ORDER
// -----------------------------------------------------------------------------
//
//   1. Resolve the eligible types for the CURRENT mode (a cheap in-memory
//      read, done per claim — see `eligibleTypes`).
//   2. Claim one row, as `executor: 'server'` with `nodeId: null`.
//   3. Nothing claimed → sleep `JOBS_POLL_MS` on an ABORTABLE timer, and go
//      round. Something claimed → do NOT sleep; a busy queue must never pause.
//   4. Look the handler up. Missing → permanent failure (below).
//   5. `throttle.acquire(job.type)` — wait out any cooldown a sibling slot's
//      429 already discovered, but only where a provider key resolves; for
//      the overwhelming majority of job types this costs nothing at all.
//   6. `withTimeout(handler.process(job), JOBS_JOB_TIMEOUT_MS)`.
//   7. Settle through `JobTerminalService`, never by writing a row here.
// =============================================================================

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from '@prisma/client';

import { JobClaimService } from './job-claim.service';
import { JobClock, JOB_CLOCK, systemJobClock } from './job-clock';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobSettleOutcome, JobTerminalService } from './job-terminal.service';
import { ProviderThrottleService } from './provider-throttle.service';

/**
 * Which job types this process's pool is allowed to claim.
 *
 *   - `all` — every registered type. The single-box posture, and the default:
 *     a deployment with no worker nodes must run all of its work somewhere,
 *     and here is the only somewhere there is.
 *   - `system` — only the types a remote node could never run (§2's derived
 *     server-only set), leaving node-eligible work to the fleet. The
 *     recommended posture once worker nodes exist: the API server stops
 *     competing with them for the expensive jobs they were added to take.
 *   - `off` — no pool at all. The process still enqueues, still serves the
 *     admin API, and never executes anything: a pure control plane.
 */
export type JobWorkerMode = 'all' | 'system' | 'off';

const WORKER_MODES: readonly string[] = ['all', 'system', 'off'];

/** Shipped defaults, repeated from `config/configuration.ts` — see `configNumber`. */
const DEFAULT_MODE: JobWorkerMode = 'all';
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_JOB_TIMEOUT_MS = 600_000;

/**
 * How much longer than a job's timeout its claim lease is good for.
 *
 * THE LEASE IS DERIVED FROM THE TIMEOUT RATHER THAN CONFIGURED SEPARATELY,
 * deliberately: two independent knobs whose only requirement is
 * `lease > timeout` are two knobs an operator can set into a state where the
 * lease reaper (#263) requeues jobs that are still running perfectly well —
 * producing duplicate work that looks like a queue bug and is really a typo.
 * Deriving it makes that state unrepresentable.
 */
const LEASE_GRACE_MS = 60_000;

/**
 * The lease used when per-job timeouts are DISABLED (`JOBS_JOB_TIMEOUT_MS=0`).
 *
 * There is no timeout to derive from, so this is the answer to "how long may
 * a job hold a claim before we assume its process died". An hour is long
 * enough that no legitimate job is reaped mid-run and short enough that a
 * crashed worker's jobs come back the same day.
 */
const UNBOUNDED_LEASE_MS = 3_600_000;

/**
 * How long `stop()` waits for in-flight jobs before returning anyway.
 *
 * BOUNDED ON PURPOSE. `onModuleDestroy` runs while an orchestrator is already
 * counting down to SIGKILL, and a slot running a ten-minute job cannot be
 * hurried. Waiting for it would turn a graceful shutdown into a hard kill.
 * Past this grace the job is simply left: its row stays `running` with a
 * lease that will expire, which is precisely the state the lease reaper
 * (#263) exists to find and requeue. Nothing is lost; one job is delayed.
 */
const SHUTDOWN_GRACE_MS = 5_000;

/**
 * Whether an unrecognised `JOBS_WORKER_MODE` has already been reported.
 *
 * MODULE-LEVEL, AND THAT IS THE POINT. The mode is re-read on every claim (so
 * it is never captured stale at bootstrap), which means a typo would
 * otherwise produce a warning per slot per poll — several a second, forever,
 * burying the one line an operator needs to see. A latch turns it into
 * exactly one line at the top of the log.
 */
let unknownModeWarned = false;

/**
 * Clears the once-only warning latch above.
 *
 * FOR TESTS ONLY. A latch that survives between test cases would make "warns
 * exactly once" pass for the first case and vacuously for every case after
 * it, which is the opposite of what that test is for. Nothing in the
 * application calls this.
 */
export function resetUnknownWorkerModeWarning(): void {
  unknownModeWarned = false;
}

/**
 * What a per-job timeout throws.
 *
 * A distinct class rather than a bare `Error` so the failure is greppable in
 * `Job.lastError` and so a fork's own tooling can recognise it. It carries no
 * status code and no throttle-ish name, so `classifyRateLimit` correctly
 * leaves it on the ordinary retry path: a job that ran too long is a job that
 * failed, not a provider asking us to slow down.
 */
export class JobTimeoutError extends Error {
  constructor(
    readonly jobId: string,
    readonly jobType: string,
    readonly timeoutMs: number
  ) {
    super(`Job ${jobId} (${jobType}) exceeded its ${timeoutMs}ms timeout`);
    this.name = 'JobTimeoutError';
  }
}

/**
 * A pending timer, plus what to do with its waiter if shutdown cancels it.
 *
 * Every timer this class creates goes in one `Set` so `stop()` can clear all
 * of them, and every one is `unref`'d so a pending poll sleep can never hold
 * a shutting-down process open — the same reasoning `systemJobClock` gives
 * for its own timer, applied to timers that must ALSO be individually
 * cancellable, which is why they are here rather than behind `JobClock.sleep`.
 */
interface PendingTimer {
  timer: ReturnType<typeof setTimeout>;

  /** Called instead of the timer's own callback when `stop()` cancels it. */
  abort: () => void;
}

@Injectable()
export class JobWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobWorker.name);

  private readonly clock: JobClock;

  /** False stops every loop at its next check; `stop()` also aborts their sleeps. */
  private running = false;

  /** One promise per slot loop, awaited (with a grace) by `stop()`. */
  private slots: Promise<void>[] = [];

  /** Every live timer this worker owns. See `PendingTimer`. */
  private readonly timers = new Set<PendingTimer>();

  /**
   * Extra types already reported as unregistered, so the warning in
   * `systemModeEligibleTypes` is once per type rather than once per claim.
   * Instance-level (unlike the mode latch) because it is keyed by type and
   * a registry can legitimately differ between two workers in one test run.
   */
  private readonly warnedUnknownExtraTypes = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly registry: JobHandlerRegistry,
    private readonly claims: JobClaimService,
    private readonly terminal: JobTerminalService,
    private readonly throttle: ProviderThrottleService,
    // OPTIONAL and unprovided in `JobsModule`, exactly as in
    // `JobTerminalService` — production always gets the real clock. Only
    // `now()` is taken from it here; the sleeps are local timers because they
    // must be individually cancellable (see `PendingTimer`).
    @Optional() @Inject(JOB_CLOCK) clock?: JobClock
  ) {
    this.clock = clock ?? systemJobClock;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Starts the pool — from the BOOTSTRAP phase, for the reason the file
   * header spends most of its length on. Do not move this to `onModuleInit`.
   */
  onApplicationBootstrap(): void {
    const mode = this.mode();

    if (mode === 'off') {
      this.logger.log(
        'Worker mode is "off": no job will be claimed by this process. ' +
          'It still enqueues jobs and serves the queue API.'
      );

      return;
    }

    const concurrency = this.concurrency();

    if (concurrency <= 0) {
      this.logger.warn(
        `Worker concurrency is ${concurrency}: no slot loop will run. Set ` +
          'JOBS_WORKER_CONCURRENCY above zero, or JOBS_WORKER_MODE=off to say so deliberately.'
      );

      return;
    }

    this.start(concurrency);
  }

  /** Stops claiming, aborts every sleep, and waits (briefly) for in-flight jobs. */
  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * Spawns `concurrency` independent slot loops.
   *
   * Public so a test can run a pool without a Nest lifecycle; idempotent, so
   * a second call while running is a no-op rather than a doubled pool.
   */
  start(concurrency: number = this.concurrency()): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.slots = Array.from({ length: concurrency }, (_unused, slot) => this.slotLoop(slot));

    this.logger.log(
      `Job worker started: ${concurrency} slot(s), mode "${this.mode()}", ` +
        `poll ${this.pollMs()}ms, job timeout ${this.timeoutMs() || 'disabled'}`
    );
  }

  /**
   * Stops the pool and resolves once every slot has finished or the grace has
   * elapsed. Safe to call when not running, and safe to call twice.
   */
  async stop(graceMs: number = SHUTDOWN_GRACE_MS): Promise<void> {
    this.running = false;

    // Cancel every live timer BEFORE awaiting the loops. A slot parked in a
    // five-second poll sleep would otherwise take up to five seconds to
    // notice it should exit; aborting the sleep wakes it immediately, it sees
    // `running === false`, and it returns.
    const pending = [...this.timers];
    this.timers.clear();

    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.abort();
    }

    const slots = this.slots;
    this.slots = [];

    if (slots.length === 0) {
      return;
    }

    await this.awaitSlots(slots, graceMs);
  }

  // ---------------------------------------------------------------------------
  // Mode and eligibility — resolved PER CLAIM, never captured at bootstrap
  // ---------------------------------------------------------------------------

  /**
   * The configured mode, falling open to `all` on anything unrecognised.
   *
   * ⚠ FAILS OPEN, DELIBERATELY. The safe-looking alternative is to fail
   * closed — refuse to start on a value nobody recognises — and it is worse:
   * a typo in one env file (`JOBS_WORKER_MODE=sytem`) would silently stop ALL
   * background processing, and the symptom is "jobs stopped running" hours
   * later with nothing obviously broken. Running the default and saying so
   * loudly is the recoverable failure; stopping every job in the deployment
   * is not.
   *
   * The warning is latched at MODULE level because this method runs on every
   * claim — see `unknownModeWarned`.
   */
  mode(): JobWorkerMode {
    const raw = this.config.get<string>('jobs.workerMode');
    const value = (typeof raw === 'string' ? raw : DEFAULT_MODE).trim().toLowerCase();

    if (WORKER_MODES.includes(value)) {
      return value as JobWorkerMode;
    }

    if (!unknownModeWarned) {
      unknownModeWarned = true;

      this.logger.warn(
        `Unrecognised JOBS_WORKER_MODE "${raw}"; expected one of ` +
          `${WORKER_MODES.join(', ')}. Falling back to "${DEFAULT_MODE}" so background ` +
          'work keeps running — fix the value to silence this.'
      );
    }

    return DEFAULT_MODE;
  }

  /**
   * The job types this worker may claim right now.
   *
   * RESOLVED PER CLAIM, not captured at bootstrap. Capturing would make
   * `system` mode depend on registration order — a handler whose module
   * resolves after the worker's would be missing from a list computed once —
   * and it would make the mode a value baked into a running process rather
   * than one read from the environment. Both reads below are in-memory (a
   * `Map` walk and a `ConfigService` lookup), so doing this every poll costs
   * nothing measurable next to the claim query it precedes.
   */
  eligibleTypes(): string[] {
    const mode = this.mode();

    if (mode === 'off') {
      return [];
    }

    return mode === 'system' ? this.systemModeEligibleTypes() : this.registry.types();
  }

  /**
   * `system` mode's list: everything a remote node could never run, plus the
   * operator's explicit additions.
   *
   * The base is `registry.serverOnlyTypes()` — DERIVED from which optional
   * members each handler carries (§2), never a second hand-maintained list
   * that could disagree with the handlers themselves.
   *
   * `JOBS_SYSTEM_MODE_EXTRA_TYPES` is the escape hatch for the case the
   * derivation cannot know about: a type that IS node-eligible but that this
   * deployment still wants the server to claim — because its node fleet is
   * small, or paused, or does not run that type. Overlap with the fleet is
   * SAFE rather than tolerated: `SKIP LOCKED` means a server and a node
   * racing for the same row produce one winner and one empty result, never a
   * double claim (§4.4).
   *
   * An entry that is not registered in this process is DROPPED with a warning
   * rather than passed through. Claiming a type with no handler here is not a
   * harmless no-op — the claim succeeds, the lookup fails, and the job is
   * failed PERMANENTLY (see `runJob`). Silently destroying jobs is a far
   * worse answer to a typo than declining to claim them.
   */
  systemModeEligibleTypes(): string[] {
    const registered = new Set(this.registry.types());
    const eligible = new Set(this.registry.serverOnlyTypes());

    for (const extra of this.extraTypes()) {
      if (!registered.has(extra)) {
        if (!this.warnedUnknownExtraTypes.has(extra)) {
          this.warnedUnknownExtraTypes.add(extra);

          this.logger.warn(
            `JOBS_SYSTEM_MODE_EXTRA_TYPES names "${extra}", which no handler in ` +
              'this process registers; ignoring it. Claiming a type with no handler ' +
              'would fail those jobs permanently.'
          );
        }

        continue;
      }

      eligible.add(extra);
    }

    return [...eligible];
  }

  // ---------------------------------------------------------------------------
  // The slot loop
  // ---------------------------------------------------------------------------

  /**
   * One slot: claim ONE, run it, repeat; sleep only when there was nothing to
   * claim.
   *
   * NEVER THROWS. A rejection escaping here would end this loop for the life
   * of the process, and a pool that has quietly lost its slots one by one has
   * a throughput of zero with nothing in the logs but a stack trace from an
   * hour ago — the same failure `safeTerminalUpdate` is written to avoid from
   * its side.
   */
  private async slotLoop(slot: number): Promise<void> {
    while (this.running) {
      let job: Job | undefined;

      try {
        job = await this.claimOne();
      } catch (error) {
        // The database is unreachable, or the claim statement failed. Back
        // off for a poll interval rather than spinning on the error.
        this.logger.error(
          `Slot ${slot} could not claim a job: ${describe(error)}. ` +
            `Retrying in ${this.pollMs()}ms.`
        );

        await this.idle(this.pollMs());
        continue;
      }

      if (!job) {
        await this.idle(this.pollMs());
        continue;
      }

      try {
        await this.runJob(job);
      } catch (error) {
        // `runJob` is written not to throw; this is the belt to its braces.
        // Losing the slot would be permanent, so an unexpected rejection is
        // logged and the loop continues.
        this.logger.error(
          `Slot ${slot} saw an unexpected error settling job ${job.id}: ${describe(error)}`
        );
      }

      // NO SLEEP after real work. Sleeping here would cap throughput at one
      // job per slot per poll interval no matter how deep the backlog is.
    }
  }

  /** One claim, for this slot, in whatever mode is configured right now. */
  private async claimOne(): Promise<Job | undefined> {
    const rows = await this.claims.claim({
      // The in-process worker is not a node: `null` node id, `server`
      // executor. `JobClaimService` is shared verbatim with the node control
      // plane (#268), which is why this is a parameter rather than something
      // the claim service knows about its caller.
      nodeId: null,
      executor: 'server',
      eligibleTypes: this.eligibleTypes(),
      // ONE. See the file header on why this is not a batch.
      limit: 1,
      leaseMs: this.leaseMs(),
    });

    return rows[0];
  }

  /**
   * Runs one claimed job and settles it. Resolves with what the terminal
   * service decided; never rejects.
   *
   * Public so a test can exercise a single job without spinning a pool, and
   * so the shape of "what happens to one claimed job" is readable in one
   * method rather than inlined in a loop.
   */
  async runJob(job: Job): Promise<JobSettleOutcome> {
    const handler = this.registry.get(job.type);

    if (!handler) {
      // PERMANENT, NOT A RETRY. A retry would re-enter this same process,
      // find the same registry, and reach the same conclusion — burning the
      // attempt budget over a couple of minutes to learn nothing. The type is
      // either gone, misspelled, or claimed by a mode that should not have
      // claimed it, and all three need a human rather than another attempt.
      //
      // Note the row is still written by `JobTerminalService`: `permanent`
      // is a flag INTO the chokepoint, not a licence to write a terminal row
      // from here. See its `CompleteFailedOptions`.
      this.logger.error(
        `Job ${job.id} has type "${job.type}", which no handler in this process ` +
          'registers; failing it permanently.'
      );

      return this.terminal.completeFailed(
        job,
        new Error(`No handler is registered for job type "${job.type}"`),
        { permanent: true }
      );
    }

    const startedAt = this.clock.now();

    try {
      // Wait out a cooldown a sibling slot's 429 already discovered. A no-op
      // (no map hit, no await, no timer) for any type with no provider key,
      // which is every type this framework ships.
      await this.throttle.acquire(job.type);

      await this.withTimeout(handler.process(job), this.timeoutMs(), job);
    } catch (error) {
      return this.terminal.completeFailed(job, error);
    }

    this.logger.debug(
      `Job ${job.id} (${job.type}) finished in ${this.clock.now() - startedAt}ms`
    );

    // OUTSIDE the try. If the terminal write for a SUCCESSFUL job somehow
    // threw, treating that as a job failure would record the wrong thing
    // about work that actually completed. (`completeSucceeded` is written not
    // to throw; this is about not encoding the opposite assumption here.)
    return this.terminal.completeSucceeded(job);
  }

  // ---------------------------------------------------------------------------
  // Timers: the per-job timeout and the poll sleep
  // ---------------------------------------------------------------------------

  /**
   * `work`, or a `JobTimeoutError` if `ms` elapses first. `ms <= 0` disables
   * the timeout entirely and returns `work` untouched.
   *
   * ⚠ THE WORK IS NOT CANCELLED, BECAUSE JAVASCRIPT CANNOT CANCEL IT. There
   * is no way to stop a promise that is mid-`await`; the honest thing to do
   * is free the SLOT — which is the scarce resource — and let the abandoned
   * work settle whenever it settles. The row is already accounted for: the
   * timeout goes through `completeFailed` like any other failure, so the job
   * retries or fails on its normal budget.
   *
   * ⚠ AND THIS IS WHY THE REACTIONS BELOW ARE ATTACHED UNCONDITIONALLY. A
   * naive `Promise.race([work, timeout])` attaches nothing of its own to
   * `work` once the race is decided, so a work promise that rejects AFTER
   * losing the race is a promise with no rejection handler — an
   * `unhandledRejection`, which in Node's default posture terminates the
   * process. That is the exact bug this shape exists to avoid: `work.then(…,
   * …)` is registered before the race can be decided and stays registered
   * forever, and settling an already-settled promise is a harmless no-op.
   */
  private withTimeout<T>(work: Promise<T>, ms: number, job: Job): Promise<T> {
    if (ms <= 0) {
      return work;
    }

    return new Promise<T>((resolve, reject) => {
      const entry = this.track(
        ms,
        () => {
          this.logger.warn(
            `Job ${job.id} (${job.type}) exceeded its ${ms}ms timeout; freeing the ` +
              'slot now and letting the abandoned work settle in the background.'
          );

          reject(new JobTimeoutError(job.id, job.type, ms));
        },
        // Shutdown cancelled the timer: do nothing. The reactions below still
        // settle this promise when the work finishes, and a process on its
        // way out has no use for a timeout.
        () => undefined
      );

      work.then(
        (value) => {
          this.clear(entry);
          resolve(value);
        },
        (error: unknown) => {
          this.clear(entry);
          reject(error);
        }
      );
    });
  }

  /**
   * Sleeps `ms` on a timer that shutdown can abort.
   *
   * NOT `JobClock.sleep`, and the difference is the reason this is here: that
   * sleep is fire-and-forget with no handle, so a worker parked in one could
   * only be woken by waiting it out. These are tracked in `this.timers` and
   * cleared by `stop()`, which is what makes `onModuleDestroy` return in
   * milliseconds instead of up to a full poll interval.
   */
  private idle(ms: number): Promise<void> {
    if (!this.running) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.track(ms, resolve, resolve);
    });
  }

  /** Registers an `unref`'d timer in `this.timers`. See `PendingTimer`. */
  private track(ms: number, onFire: () => void, onAbort: () => void): PendingTimer {
    const entry: PendingTimer = {
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      abort: onAbort,
    };

    entry.timer = setTimeout(() => {
      this.timers.delete(entry);
      onFire();
    }, ms);

    // A pending timer must never hold a shutting-down process open — the same
    // argument `systemJobClock` makes for its own.
    if (typeof (entry.timer as { unref?: () => void }).unref === 'function') {
      (entry.timer as unknown as { unref: () => void }).unref();
    }

    this.timers.add(entry);

    return entry;
  }

  /** Cancels a tracked timer without firing it. */
  private clear(entry: PendingTimer): void {
    clearTimeout(entry.timer);
    this.timers.delete(entry);
  }

  /** Waits for every slot loop, or for `graceMs`, whichever comes first. */
  private async awaitSlots(slots: Promise<void>[], graceMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(
          `Shutting down with ${slots.length} slot(s) still running after ${graceMs}ms; ` +
            'leaving their jobs for the lease reaper.'
        );

        resolve();
      }, graceMs);

      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as unknown as { unref: () => void }).unref();
      }
    });

    try {
      await Promise.race([Promise.all(slots), grace]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** `JOBS_WORKER_CONCURRENCY` — fixed at startup; the pool is not resized. */
  private concurrency(): number {
    return this.configNumber('jobs.workerConcurrency', DEFAULT_CONCURRENCY);
  }

  /** `JOBS_POLL_MS` — how long an EMPTY queue sleeps before asking again. */
  private pollMs(): number {
    return Math.max(1, this.configNumber('jobs.pollMs', DEFAULT_POLL_MS));
  }

  /** `JOBS_JOB_TIMEOUT_MS` — `0` disables per-job timeouts entirely. */
  private timeoutMs(): number {
    return Math.max(0, this.configNumber('jobs.jobTimeoutMs', DEFAULT_JOB_TIMEOUT_MS));
  }

  /** See `LEASE_GRACE_MS` for why this is derived rather than configured. */
  private leaseMs(): number {
    const timeout = this.timeoutMs();

    return timeout > 0 ? timeout + LEASE_GRACE_MS : UNBOUNDED_LEASE_MS;
  }

  /** `JOBS_SYSTEM_MODE_EXTRA_TYPES`, already split by `configuration.ts`. */
  private extraTypes(): string[] {
    const value = this.config.get<unknown>('jobs.systemModeExtraTypes');

    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
    }

    // Tolerated for a directly-constructed test double, and for a fork that
    // decides to keep the raw string in its own configuration factory.
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }

    return [];
  }

  /**
   * A numeric setting with a defensive fallback, for the same reason
   * `JobTerminalService.configNumber` has one: this class is also constructed
   * directly in unit tests with a stub `ConfigService`, and a missing key
   * must degrade to the shipped behaviour rather than to `NaN` — which here
   * would mean a `setTimeout(NaN)` firing immediately and a poll loop
   * spinning the event loop flat out.
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
