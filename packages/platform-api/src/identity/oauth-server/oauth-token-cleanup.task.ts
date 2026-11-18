// =============================================================================
// The hourly `oauth.token.cleanup` scheduler (PP-15.8, #1186)
// =============================================================================
//
// THIS TASK DELETES NOTHING. It enqueues a housekeeping job (global, `orgId`
// null) and `OAuthTokenCleanupHandler` does the work on a worker slot.
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { IDENTITY_JOBS, type IdentityJobsPort } from '../ports';
import { OAUTH_TOKEN_CLEANUP_TYPE } from './oauth-token-cleanup.handler';

@Injectable()
export class OAuthTokenCleanupTask {
  private readonly logger = new Logger(OAuthTokenCleanupTask.name);

  constructor(@Inject(IDENTITY_JOBS) private readonly jobs: IdentityJobsPort) {}

  /** Seven minutes past every hour (off the hour so deployments do not all fire at once). */
  @Cron('7 * * * *')
  async handleCron(): Promise<void> {
    await this.jobs.enqueueHousekeepingJob({ logger: this.logger, type: OAUTH_TOKEN_CLEANUP_TYPE, what: 'oauth token cleanup' });
  }
}
