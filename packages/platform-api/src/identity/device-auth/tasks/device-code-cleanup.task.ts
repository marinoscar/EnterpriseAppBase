// =============================================================================
// The nightly device-code cleanup scheduler (issue #353, epic #345)
// =============================================================================
//
// ⚠ THIS TASK DELETES NOTHING. It enqueues a job, and
// `device-auth/handlers/device-code-cleanup.handler.ts` does the work on a
// worker slot. See that handler's header for why, and
// `jobs/housekeeping.enqueue.ts` for the two guards in front of the enqueue.
//
// 2am, unchanged from before the conversion.
// =============================================================================

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { IDENTITY_JOBS, type IdentityJobsPort } from '../../ports';
import { DEVICE_CODE_CLEANUP_TYPE } from '../handlers/device-code-cleanup.handler';

@Injectable()
export class DeviceCodeCleanupTask {
  private readonly logger = new Logger(DeviceCodeCleanupTask.name);

  constructor(
    @Inject(IDENTITY_JOBS) private readonly jobs: IdentityJobsPort,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleCleanup(): Promise<void> {
    await this.jobs.enqueueHousekeepingJob({
      logger: this.logger,
      type: DEVICE_CODE_CLEANUP_TYPE,
      what: 'device code cleanup',
    });
  }
}
