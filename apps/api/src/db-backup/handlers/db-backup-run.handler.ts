// =============================================================================
// `db.backup.run` — the database dump as a queue job (issue #351, epic #345)
// =============================================================================
//
// THE CHANGE THE WHOLE EPIC EXISTS FOR. Until now "back up now" was a detached
// promise: `DatabaseBackupRunnerService.startBackup` awaited an INSERT and
// then fired `void this.executeRun(...)`. The dump had no job type, appeared
// in neither `GET /api/admin/jobs` nor insights, occupied no worker slot, had
// no timeout, and could not run anywhere but the API process. This handler is
// what ends that.
//
// -----------------------------------------------------------------------------
// THE THREE OBJECTIONS `schema.prisma` RAISED, AND WHERE EACH IS NOW ANSWERED
// -----------------------------------------------------------------------------
//
// The `### Why this is not a queue job` block in the schema was RIGHT when it
// was written, and it is worth reading what changed rather than assuming it
// was merely overcautious. It gave three reasons, and this file's two-line
// `profile` answers two of them by configuration while #347 answered the
// third by implementation:
//
//   1. "`jobs.stuckThresholdMinutes` DEFAULTS TO 30 MINUTES, so the reaper
//      would reset a running dump to `pending` and a SECOND `pg_dump` would
//      start against the same storage key." → `maxRuntimeMs: 6h`. The lease is
//      DERIVED from that ceiling (`resolveJobLeaseMs` = ceiling + grace), never
//      declared beside it, so the reaper's deadline is longer than the
//      permitted runtime BY CONSTRUCTION — the disagreement the old comment
//      described is now unrepresentable rather than merely unlikely. See
//      `job-execution-profile.ts`'s header for the full argument.
//   2. "THE IN-PROCESS WORKER HAS NO LEASE-RENEWAL PATH." → #347 gave it one.
//      `JobWorker` renews on a ticker (lease ÷ 3) for exactly as long as
//      `process()` runs, so a six-hour dump holds its claim by continuously
//      proving it is alive rather than by a lease long enough to cover the
//      worst case.
//   3. "A JOB HAS `attempts` AND A RETRY BUDGET." → `maxAttempts: 1`, below.
//
// -----------------------------------------------------------------------------
// ⚠ `maxAttempts: 1` — THE THIRD ARGUMENT, ANSWERED BY CONFIGURATION
// -----------------------------------------------------------------------------
//
// Re-running a failed multi-gigabyte dump is exactly the wrong behaviour, and
// nothing about moving onto the queue makes it less wrong: it burns hours of
// I/O on a database that is probably already unwell, unattended, at whatever
// hour the first attempt died — and it does it while the operator is asleep,
// against a server that may be failing for reasons a second full read will
// make worse. THE CORRECT RETRY FOR A BACKUP IS THE NEXT SCHEDULED ONE.
//
// What changed is not the policy but WHO ENFORCES IT. Before #351 that
// sentence was true because there was no queue to disagree with it; the dump
// simply lived outside anything that could retry it, and the guarantee rested
// on the absence of a mechanism. Now `JobStuckService`'s give-up phase reads
// this exact number through `resolveMaxAttempts` and permanently fails a
// `db.backup.run` whose attempt budget is spent, instead of requeueing it —
// so "never automatically retried" is a declared property the queue enforces
// rather than a property of not being in the queue.
//
// A useful consequence: because `attempts` is charged AT CLAIM TIME
// (`job-claim.service.ts`), a dump whose process is OOM-killed mid-run has
// already spent its only attempt. The lease expires, the reaper finds it, and
// the give-up phase fails it — it is not re-dumped by the very condition that
// killed it.
//
// -----------------------------------------------------------------------------
// WHY THIS CLASS IS FOUR LINES OF BEHAVIOUR AND NOT FOUR HUNDRED
// -----------------------------------------------------------------------------
//
// `process()` delegates to `DatabaseBackupRunnerService.runQueuedBackup` and
// does nothing else. That is not thinness for its own sake: the runner is THE
// ONE WRITER of `database_backup_runs` (`db-backup.module.ts` says so, and the
// single-active-run index is only a guarantee if that stays true), and the
// streaming contract its header spends 150 lines stating — the metering
// transform, the two-way `Promise.all`, delete-before-mark-failed, verify what
// arrived — must not acquire a second implementation here.
//
// REJECTED: a thin wrapper that calls `startBackup()` and returns. That is the
// escape hatch the old schema comment explicitly permitted ("a job handler may
// call `startBackup()` and return — but the dump's lifetime must never be a
// job's lifetime"), and it buys a dashboard row and nothing else: the job
// would settle in milliseconds while the dump ran for hours, so there would
// still be no lease, no slot accounting, no timeout and no possibility of node
// execution. `runQueuedBackup` is AWAITED, so the job's lifetime IS the dump's
// lifetime, which is the entire point.
//
// -----------------------------------------------------------------------------
// ⚠ NOT NODE-ELIGIBLE, AND NOT BY OVERSIGHT
// -----------------------------------------------------------------------------
//
// There is no `nodeResultSchema`, no `persistNodeResult` and no
// `deriveOutputKey` here, so `JobHandlerRegistry.serverOnlyTypes()` derives
// this type as server-only and no node can claim it — which is correct for
// today: a worker node has no database credentials and no `pg_dump`. Issue
// #352 adds all three together, because the eligibility rule
// (`job-handler.interface.ts`) is BOTH members or NEITHER: a schema with no
// persist function describes a payload nobody can store, and a persist
// function with no schema would trust an unvalidated remote body. Do not add
// one of them here ahead of the other.
//
// -----------------------------------------------------------------------------
// #350 ADDS THE CREDENTIAL, WHICH IS A DIFFERENT FACT FROM ELIGIBILITY
// -----------------------------------------------------------------------------
//
// `nodeSecretBroker` (below) declares that a REMOTE executor of this type needs
// a database credential and names the thing that mints it. It changes nothing
// about the paragraph above: a broker is not `nodeResultSchema`, this type is
// still in `serverOnlyTypes()`, and no node can claim it until #352. The two
// halves land separately on purpose — the broker is the half that needed a real
// PostgreSQL to review (`pg-job-role.broker.db.spec.ts` dumps the database as
// the minted role), and it is inert until the result contract exists.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job } from '@prisma/client';

import {
  BACKUP_JOB_TYPE,
  DatabaseBackupRunnerService,
} from '../db-backup-runner.service';
import { JobHandler } from '../../jobs/job-handler.interface';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import type { JobExecutionProfile } from '../../jobs/job-execution-profile';
import type { JobSecretBroker } from '../../jobs/job-secret-broker';
import { PgJobRoleBroker } from '../pg-job-role.broker';

/**
 * The wall-clock ceiling for one dump, in milliseconds.
 *
 * SIX HOURS, and the number is chosen to be uninteresting rather than tight.
 * It is not a target — a dump that takes six hours is a deployment with a
 * problem — it is the point past which "still streaming" stops being a
 * credible explanation and a wedged process is the better hypothesis. The
 * alternative to a large ceiling is not a small one, it is `0` (no ceiling at
 * all), and that trades a stuck backup slot that eventually frees itself for
 * one that never does.
 *
 * ⚠ IT IS ALSO THE LEASE, INDIRECTLY. `resolveJobLeaseMs` derives the claim's
 * lease from this number, so raising it lengthens how long a dead executor's
 * claim survives before the reaper reclaims it. That coupling is deliberate
 * (see `job-execution-profile.ts`); it is the reason a lease may not be
 * declared separately.
 */
export const BACKUP_JOB_MAX_RUNTIME_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class DatabaseBackupRunHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(DatabaseBackupRunHandler.name);

  /**
   * Imported from the runner rather than written out here, because the
   * enqueueing side and the executing side must agree on it exactly and only
   * one of the two can own the definition. See `BACKUP_JOB_TYPE`.
   */
  readonly type = BACKUP_JOB_TYPE;

  /**
   * The two numbers this type is unlike the rest of the queue in — and there
   * will only ever be two (`job-execution-profile.ts` explains why a lease and
   * a renewal interval are derived rather than declared).
   *
   * See this file's header for the argument behind each: `maxRuntimeMs`
   * answers the reaper objection, `maxAttempts: 1` answers the retry
   * objection.
   */
  readonly profile: JobExecutionProfile = {
    maxRuntimeMs: BACKUP_JOB_MAX_RUNTIME_MS,
    maxAttempts: 1,
  };

  /**
   * The credential a REMOTE executor of this type needs — the first broker
   * registered anywhere in this repository (#350, epic #345).
   *
   * ⚠ PRESENCE IS THE DECLARATION, exactly as it is for `nodeResultSchema` +
   * `persistNodeResult`. There is no `requiresSecret: 'postgres'` string and no
   * switch keyed on one; hanging the implementation itself off the handler is
   * what makes "a type that names a secret nobody can mint" unrepresentable.
   * See `job-secret-broker.ts`'s header for the whole argument.
   *
   * ⚠ THIS DOES NOT MAKE THE TYPE NODE-ELIGIBLE, AND THE TWO ARE INDEPENDENT
   * FACTS. Eligibility is derived from `nodeResultSchema` + `persistNodeResult`,
   * which #352 adds; until then `JobHandlerRegistry.serverOnlyTypes()` still
   * contains this type and no node can claim it. Declaring the broker first is
   * deliberate — it is the half that needs a real PostgreSQL to review, and it
   * is inert until the other half lands.
   *
   * ⚠ NOR IS IT PERMISSION TO USE ONE. Whether a node in THIS deployment may
   * hold a credential to THIS database is an administrator's trust-boundary
   * decision: `nodes.jobSecretBrokerEnabled`, default OFF. With it off the type
   * is withheld from the claim entirely (`NodesService.nodeEligibleTypes`) and
   * the secret route refuses with a named reason.
   *
   * Injected rather than constructed here so the broker is a normal provider
   * with a substitutable cluster seam — and so that exactly one instance exists,
   * which is what makes its `CREATEROLE` probe cache mean anything.
   */
  readonly nodeSecretBroker: JobSecretBroker;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly runner: DatabaseBackupRunnerService,
    broker: PgJobRoleBroker
  ) {
    this.nodeSecretBroker = broker;
  }

  /** Self-registration — the only wiring a handler needs. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Takes the backup, AWAITED to completion.
   *
   * Returns when `pg_dump` has finished, the archive has been uploaded, and
   * the STORED OBJECT has been read back through `pg_restore --list` — so a
   * `succeeded` job of this type means a run that was verified, not merely one
   * that was started. Throws whatever the dump failed with, after the runner
   * has recorded it on the run row; with `maxAttempts: 1` the worker turns
   * that into a terminal `failed` and never a retry.
   */
  async process(job: Job): Promise<void> {
    this.logger.log(`Taking a database backup for job ${job.id}.`);

    await this.runner.runQueuedBackup(job);
  }
}
