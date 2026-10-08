import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobHandlerRegistry, JobsService, enqueueHousekeepingJob, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../prisma/prisma.service';

/** The job type. Permanent once jobs of this type exist: never rename it. */
export const NOTES_ARCHIVE_JOB = 'notes.archive';

/**
 * Archives notes nobody edited for `notes.archiveAfterDays` days.
 *
 * A registered job handler (it self-registers in `onModuleInit`), so the
 * work is visible, retried and accounted for on the platform queue. Server
 * only: it writes as it goes, so it carries neither `nodeResultSchema` nor
 * `persistNodeResult`.
 */
@Injectable()
export class NotesArchiveHandler implements JobHandler, OnModuleInit {
  readonly type = NOTES_ARCHIVE_JOB;
  readonly label = 'Archive old notes';
  readonly profile = { maxRuntimeMs: 5 * 60_000, maxAttempts: 3 };
  private readonly logger = new Logger(NotesArchiveHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly settings: SystemSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const days = (await this.settings.getNamespace('notes')).archiveAfterDays;
    if (days === 0) return;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const { count } = await this.prisma.note.updateMany({
      where: { archived: false, updatedAt: { lt: cutoff } },
      data: { archived: true },
    });
    this.logger.log(`job ${job.id}: archived ${count} note(s) untouched since ${cutoff.toISOString()}`);
  }
}

/**
 * The nightly trigger. A `@Cron` only decides whether work is due and
 * ENQUEUES it (CLAUDE.md queue rule 1; the `cronEnqueueOnly` conformance
 * suite checks the body).
 */
@Injectable()
export class NotesArchiveTask {
  private readonly logger = new Logger(NotesArchiveTask.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    await enqueueHousekeepingJob({ jobs: this.jobs, prisma: this.prisma, logger: this.logger, type: NOTES_ARCHIVE_JOB, what: 'notes archive' });
  }
}
