// =============================================================================
// `ai.runs.purge` job handler (#681, platform-packages PP-1.10)
// =============================================================================
//
// Deletes `ai_runs` rows created before `retention.aiRuns.days` ago (default
// 90), in bounded batches. `ai_runs.request` holds the user's complete prompt,
// so keeping runs forever is a privacy problem as well as a size one. Enqueued
// once a day by `RetentionPurgeTask`, which only enqueues.
//
// TERMINAL RUNS ONLY: `succeeded`, `failed`, `cancelled`. A `pending` or
// `running` run is never touched at any age — its job may still be executing
// it, and deleting the row under the handler would lose the result.
//
// Storage objects a run produced (`ai-outputs/<userId>/<runId>/…`) are NOT
// deleted: they are user files with their own `storage_objects` lifecycle, and
// deleting the run row does not orphan them.
//
// NOT GATED ON THE KILL SWITCH. Retention is data hygiene, not AI usage — the
// argument `ai-usage-purge.handler.ts` makes. The job makes no provider call
// and reads no key.
//
// SERVER-ONLY, like every `ai.*` type (docs/specs/ai-platform.md): no
// `nodeResultSchema`/`persistNodeResult`.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from '@prisma/client';

import { runRetentionPolicyPurge } from '../../common/retention/batched-purge';
import { JobExecutionProfile } from '../../jobs/job-execution-profile';
import { JobHandler } from '../../jobs/job-handler.interface';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemSettingsService } from '../../settings/system-settings/system-settings.service';
import type { AiRunStatus } from './ai-runtime.types';

/** The job type. PERMANENT once rows of it exist. */
export const AI_RUNS_PURGE_TYPE = 'ai.runs.purge';

/** The statuses this purge may delete. `pending` and `running` are deliberately absent. */
export const PURGEABLE_AI_RUN_STATUSES: readonly AiRunStatus[] = ['succeeded', 'failed', 'cancelled'];

@Injectable()
export class AiRunsPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(AiRunsPurgeHandler.name);

  readonly type = AI_RUNS_PURGE_TYPE;

  /** Deletes only; thirty minutes covers millions of rows. Retried like any housekeeping job. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Throws to fail (a database error), so the queue's retry applies. */
  async process(job: Job): Promise<void> {
    const { aiRuns: policy } = await this.systemSettings.getRetentionPolicy();

    await runRetentionPolicyPurge({
      job,
      logger: this.logger,
      policy,
      setting: 'retention.aiRuns',
      what: 'AI run purge',
      rows: 'AI run(s)',
      selectIds: async (cutoff, take) => {
        const rows = await this.prisma.aiRun.findMany({
          where: {
            createdAt: { lt: cutoff },
            status: { in: [...PURGEABLE_AI_RUN_STATUSES] },
          },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take,
        });

        return rows.map((row) => row.id);
      },
      // By the exact ids read. A terminal run never returns to `pending` or
      // `running`, so the ids read are still terminal when they are deleted.
      deleteIds: async (ids) =>
        (await this.prisma.aiRun.deleteMany({ where: { id: { in: ids } } })).count,
    });
  }
}
