// =============================================================================
// DatabaseBackupRunHandler unit coverage (issue #351, epic #345)
// =============================================================================
//
// THREE PROPERTIES, AND ONLY ONE OF THEM IS ABOUT THE DUMP.
//
//   1. THE PROFILE IS WHAT IT CLAIMS TO BE, MEASURED THROUGH THE RESOLVERS
//      THE QUEUE ACTUALLY READS. Asserting `handler.profile.maxAttempts === 1`
//      would prove a literal equals itself. What matters is what
//      `resolveMaxAttempts` and `resolveJobLeaseMs` answer for THIS handler,
//      because those are the two functions the reaper's give-up phase and the
//      claim's lease are computed from — the exact pair that used to make a
//      backup unsafe as a queue job.
//   2. `process` IS AWAITED THROUGH, not fired and forgotten. The one line
//      that would quietly undo #351 is a missing `await`, and it would leave
//      every other assertion in this repository green.
//   3. IT IS NOT NODE-ELIGIBLE YET. #352 adds `nodeResultSchema`,
//      `persistNodeResult` and `deriveOutputKey` TOGETHER; a handler carrying
//      exactly one of the first two is a state the interface forbids, and the
//      registry deriving this type as node-eligible today would let a machine
//      with no database credentials claim a `pg_dump`.
//
// The dump itself is not re-tested here — `db-backup-runner.service.spec.ts`
// owns the streaming contract, and this handler deliberately contains no copy
// of it to test.
// =============================================================================

import { ConfigService } from '@nestjs/config';
import { Job } from '@prisma/client';

import {
  resolveJobProfile,
  resolveMaxAttempts,
} from '../../jobs/job-execution-profile';
import type { JobHandler } from '../../jobs/job-handler.interface';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { LEASE_GRACE_MS, resolveJobLeaseMs } from '../../jobs/job.worker';
import { JOB_TYPE_LABELS } from '../../jobs/job-type-labels';
import { BACKUP_JOB_TYPE } from '../db-backup-runner.service';
import type { DatabaseBackupRunnerService } from '../db-backup-runner.service';
import { BACKUP_JOB_MAX_RUNTIME_MS, DatabaseBackupRunHandler } from './db-backup-run.handler';

describe('DatabaseBackupRunHandler', () => {
  const job = { id: 'job-1', type: BACKUP_JOB_TYPE } as Job;

  let registry: JobHandlerRegistry;
  let runQueuedBackup: jest.Mock;
  let handler: DatabaseBackupRunHandler;

  /** The deployment-wide defaults, i.e. what this type must NOT be governed by. */
  const config = {
    get: jest.fn((key: string) =>
      key === 'jobs.maxAttempts' ? 3 : key === 'jobs.jobTimeoutMs' ? 600_000 : undefined
    ),
  } as unknown as ConfigService;

  beforeEach(() => {
    registry = new JobHandlerRegistry();
    runQueuedBackup = jest.fn(async () => undefined);
    handler = new DatabaseBackupRunHandler(registry, {
      runQueuedBackup,
    } as unknown as DatabaseBackupRunnerService);
  });

  it('registers itself under the type the runner enqueues, and only from onModuleInit', () => {
    // Before the lifecycle hook the registry knows nothing: registration is
    // the ONE line of wiring a handler needs, and it must be that line rather
    // than a constructor side effect the worker could race.
    expect(registry.get(BACKUP_JOB_TYPE)).toBeUndefined();

    handler.onModuleInit();

    expect(registry.get(BACKUP_JOB_TYPE)).toBe(handler);
    // The enqueue side and the execute side agree BY IMPORT, not by two
    // matching string literals that a rename could separate.
    expect(handler.type).toBe(BACKUP_JOB_TYPE);
  });

  it('has a dashboard label, so a 2am reader sees a phrase and not a dotted key', () => {
    expect(JOB_TYPE_LABELS[BACKUP_JOB_TYPE]).toBe('Database backup');
  });

  describe('the profile the queue actually reads', () => {
    it('is never automatically retried: one attempt, not the deployment default of three', () => {
      // ⚠ THE THIRD OF THE THREE OBJECTIONS `schema.prisma` RAISED, answered
      // by configuration. `JobStuckService`'s give-up phase reads exactly this
      // number, so a failed multi-gigabyte dump is permanently failed rather
      // than requeued against a database that is probably already unwell.
      expect(resolveMaxAttempts(config, handler)).toBe(1);
      // The global it is overriding, for contrast.
      expect(resolveMaxAttempts(config, undefined)).toBe(3);
    });

    it('runs for six hours, not the ten-minute global', () => {
      const profile = resolveJobProfile(handler);

      expect(profile?.maxRuntimeMs).toBe(BACKUP_JOB_MAX_RUNTIME_MS);
      expect(BACKUP_JOB_MAX_RUNTIME_MS).toBe(6 * 60 * 60 * 1000);
    });

    it('derives a lease LONGER than the runtime ceiling — the reaper cannot requeue a dump that is still streaming', () => {
      // The first objection, and the one that used to corrupt archives: a
      // lease shorter than the permitted runtime is a job that reaps itself
      // into two concurrent `pg_dump`s writing to one key. Derived, so the
      // disagreement is unrepresentable rather than merely avoided.
      const lease = resolveJobLeaseMs(config, resolveJobProfile(handler));

      expect(lease).toBe(BACKUP_JOB_MAX_RUNTIME_MS + LEASE_GRACE_MS);
      expect(lease).toBeGreaterThan(BACKUP_JOB_MAX_RUNTIME_MS);
    });
  });

  describe('process', () => {
    it('AWAITS the dump — the job does not settle before the archive is verified', async () => {
      let release!: () => void;
      const dumping = new Promise<void>((resolve) => {
        release = resolve;
      });
      runQueuedBackup.mockImplementation(async () => dumping);

      let settled = false;
      const running = handler.process(job).then(() => {
        settled = true;
      });

      // ⚠ THE ASSERTION #351 EXISTS FOR. A handler that returned here would
      // give a dashboard row and nothing else: no lease, no slot accounting,
      // no timeout, no possibility of node execution.
      await Promise.resolve();
      expect(settled).toBe(false);

      release();
      await running;
      expect(settled).toBe(true);
      expect(runQueuedBackup).toHaveBeenCalledWith(job);
    });

    it('lets the failure through, so the worker settles the job as failed', async () => {
      const boom = new Error('pg_dump exited 1');
      runQueuedBackup.mockRejectedValue(boom);

      await expect(handler.process(job)).rejects.toBe(boom);
    });
  });

  it('is SERVER-ONLY for now: #352 adds the two node members together, never one of them', () => {
    handler.onModuleInit();

    // Read through the interface, since the class does not declare either
    // member: what the registry sees is what decides eligibility.
    const registered = registry.get(BACKUP_JOB_TYPE) as JobHandler;

    expect(registered.nodeResultSchema).toBeUndefined();
    expect(registered.persistNodeResult).toBeUndefined();
    // The DERIVATION, not a flag — there is deliberately no `nodeEligible`
    // boolean to set inconsistently. `serverOnlyTypes()` is what the `system`
    // worker mode and the node claim endpoint both read.
    expect(registry.serverOnlyTypes()).toContain(BACKUP_JOB_TYPE);
  });
});
