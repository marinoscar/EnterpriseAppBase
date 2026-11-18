// =============================================================================
// The daily `oauth.client.cleanup` scheduler (PP-15.5)
// =============================================================================
//
// THIS TASK DELETES NOTHING. It enqueues a housekeeping job (global, `orgId`
// null) and `OAuthClientCleanupHandler` does the work on a worker slot.
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { IDENTITY_JOBS, type IdentityJobsPort } from '../../ports';
import { OAUTH_CLIENT_CLEANUP_TYPE } from './oauth-client-cleanup.handler';

@Injectable()
export class OAuthClientCleanupTask {
  private readonly logger = new Logger(OAuthClientCleanupTask.name);

  constructor(@Inject(IDENTITY_JOBS) private readonly jobs: IdentityJobsPort) {}

  /** 04:17 every day (off the hour so deployments do not all fire at once). */
  @Cron('17 4 * * *')
  async handleCron(): Promise<void> {
    await this.jobs.enqueueHousekeepingJob({ logger: this.logger, type: OAUTH_CLIENT_CLEANUP_TYPE, what: 'oauth client cleanup' });
  }
}
