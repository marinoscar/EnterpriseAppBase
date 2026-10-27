// =============================================================================
// Daily AI usage retention scheduler (issue #443, epic #420)
// =============================================================================
//
// ⚠ THIS TASK DELETES NOTHING. It enqueues one global `ai.usage.purge` job
// through the shared housekeeping helper, and `AiUsagePurgeHandler` does the
// deleting on a worker slot. Pinned by
// `apps/api/test/conformance.spec.ts`.
//
// 5am: after the 2am–4am housekeeping crons, so the purges do not queue up
// behind each other at the same minute.
// =============================================================================

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { enqueueHousekeepingJob } from '../../jobs/index';
import type { JobsPrisma } from '../../jobs/index';
import { JobsService } from '../../jobs/index';
import type { AiPrisma } from '../data/ai-db';
import { PLATFORM_PRISMA } from '../../core/index';
import { AI_USAGE_PURGE_TYPE } from './ai-usage-purge.handler';

@Injectable()
export class AiUsagePurgeTask {
  private readonly logger = new Logger(AiUsagePurgeTask.name);

  constructor(
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: AiPrisma,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async handleCron(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma as unknown as JobsPrisma,
      logger: this.logger,
      type: AI_USAGE_PURGE_TYPE,
      what: 'AI usage purge',
    });
  }
}
