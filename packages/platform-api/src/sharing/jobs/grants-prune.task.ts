// =============================================================================
// Daily grants prune scheduler (issue #729, PP-7.2)
// =============================================================================
//
// ⚠ THIS TASK TOUCHES NO DATABASE BUT ITS OWN QUEUE. It enqueues one global
// `sharing.grants.prune` job through the app's shared housekeeping helper
// (`SharingJobsPort.enqueueHousekeepingJob`), and `GrantsPruneHandler` does
// the deleting on a worker slot. Pinned by
// `apps/api/test/conformance.spec.ts`, which scans this slice.
// Without a jobs port bound, it does nothing.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { SHARING_JOBS, type SharingJobsPort } from '../ports';
import { GRANTS_PRUNE_JOB_TYPE } from './grants-prune.handler';

/**
 * Enqueues `sharing.grants.prune` once a day.
 *
 * @stability experimental
 */
@Injectable()
export class GrantsPruneTask {
  private readonly logger = new Logger(GrantsPruneTask.name);

  constructor(@Optional() @Inject(SHARING_JOBS) private readonly jobs?: SharingJobsPort) {}

  /** The daily tick: enqueue only. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    if (!this.jobs) return;
    await this.jobs.enqueueHousekeepingJob({ logger: this.logger, type: GRANTS_PRUNE_JOB_TYPE, what: 'grants prune' });
  }
}
