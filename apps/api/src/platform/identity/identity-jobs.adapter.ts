import { Injectable, type Logger } from '@nestjs/common';
import type { IdentityJobHandler, IdentityJobsPort } from '@marinoscar/platform-api/identity';

import { enqueueHousekeepingJob } from '../../jobs/housekeeping.enqueue';
import type { JobHandler } from '../../jobs/job-handler.interface';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { JobsService } from '../../jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';

// IDENTITY_JOBS -> the app's queue (#727). Identity's two job types
// (`auth.token.cleanup`, `auth.device-code.cleanup`) register through
// `registerHandler`, and their enqueue-only crons queue through the app's
// shared housekeeping helper, exactly as before the move.

/** Compile-time proof that an identity handler IS an app job handler. */
type AssertAssignable<_From extends _To, _To> = true;
export type IdentityJobHandlerIsJobHandler = AssertAssignable<IdentityJobHandler, JobHandler>;

/** The reference app's {@link IdentityJobsPort}. */
@Injectable()
export class IdentityJobsAdapter implements IdentityJobsPort {
  constructor(
    private readonly jobs: JobsService,
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueHousekeepingJob(options: { type: string; what: string; logger: Logger }): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: options.logger,
      type: options.type,
      what: options.what,
    });
  }

  registerHandler(handler: IdentityJobHandler): void {
    const appHandler: JobHandler = handler;
    this.registry.register(appHandler);
  }
}
