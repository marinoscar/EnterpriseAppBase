// =============================================================================
// `device-auth.code.cleanup` — expired device codes, as a queue job
// (issue #353, epic #345)
// =============================================================================
//
// The work is unchanged: `DeviceAuthService.cleanupExpiredCodes` deletes
// `device_codes` past their expiry, plus `expired` rows more than a day old.
// WHAT CHANGED IS THE EXECUTOR — until #353 the delete ran inline in a 2am
// `@Cron` that caught its own errors and logged them, which meant a failed
// cleanup was invisible in the admin job list, got no retry, and left rows an
// operator could only find by grepping.
//
// SERVER-ONLY BY DERIVATION: neither `nodeResultSchema` nor `persistNodeResult`
// (see `job-handler.interface.ts`), which is also the only correct answer for a
// job that is one `deleteMany` against this application's own database.
//
// NO PROFILE: one indexed delete is ordinary queue work, and it is idempotent,
// so the deployment-wide timeout and attempt budget are right for it. See
// `auth/handlers/token-cleanup.handler.ts` for the same argument at length.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { IDENTITY_JOBS, type IdentityJobHandler, type IdentityJobRecord as Job, type IdentityJobsPort } from '../../ports';
import { DeviceAuthService } from '../device-auth.service';

/**
 * The handler key, and therefore the `Job.type` every device-code-cleanup row
 * carries. PERMANENT — rows outlive handlers. Exported so the scheduling task
 * asks about the same string it queues.
 *
 * @stability stable
 */
export const DEVICE_CODE_CLEANUP_TYPE = 'device-auth.code.cleanup';

@Injectable()
export class DeviceCodeCleanupHandler implements IdentityJobHandler, OnModuleInit {
  private readonly logger = new Logger(DeviceCodeCleanupHandler.name);

  readonly type = DEVICE_CODE_CLEANUP_TYPE;

  constructor(
    @Inject(IDENTITY_JOBS) private readonly jobs: IdentityJobsPort,
    private readonly deviceAuth: DeviceAuthService
  ) {}

  /** Self-registration — the only wiring a handler needs. */
  onModuleInit(): void {
    this.jobs.registerHandler(this);
  }

  /**
   * Deletes expired device codes.
   *
   * THROWS TO FAIL. The old cron caught and logged; a handler must not, because
   * swallowing here would report a cleanup that did not happen as a `succeeded`
   * job — which is strictly worse than the log line it replaced.
   */
  async process(job: Job): Promise<void> {
    const count = await this.deviceAuth.cleanupExpiredCodes();

    this.logger.log(`Device code cleanup job ${job.id} removed ${count} record(s)`);
  }
}
