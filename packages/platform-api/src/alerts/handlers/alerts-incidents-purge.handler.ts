import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { ALERTS_INCIDENTS_PURGE_TYPE, ALERTS_OPTIONS } from '../alerts.constants';
import type { ResolvedAlertsModuleOptions } from '../alerts.options';
import type { AlertsPrisma } from '../data/alerts-db';

/** Rows deleted per statement. */
export const ALERTS_PURGE_BATCH = 1_000;
/** Safety stop on the batch loop. */
export const ALERTS_PURGE_MAX_BATCHES = 500;

/**
 * `alerts.incidents_purge`: deletes RESOLVED incidents older than the
 * retention. Open incidents are never touched. SERVER-ONLY.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsIncidentsPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(AlertsIncidentsPurgeHandler.name);
  readonly type = ALERTS_INCIDENTS_PURGE_TYPE;
  readonly label = 'Alert incident purge';
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 10 * 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(PLATFORM_PRISMA) private readonly prisma: AlertsPrisma,
    @Inject(ALERTS_OPTIONS) private readonly options: ResolvedAlertsModuleOptions,
  ) {}

  /** Registers the handler with the job registry. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Throws on a database error so the queue retries. */
  async process(job: Job): Promise<void> {
    const cutoff = new Date(Date.now() - this.options.incidentRetentionDays * 86_400_000);
    let deleted = 0;
    for (let batch = 0; batch < ALERTS_PURGE_MAX_BATCHES; batch += 1) {
      const rows = await this.prisma.alertIncident.findMany({
        where: { state: 'resolved', resolvedAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { resolvedAt: 'asc' },
        take: ALERTS_PURGE_BATCH,
      });
      if (rows.length === 0) break;
      const result = await this.prisma.alertIncident.deleteMany({ where: { id: { in: rows.map((r) => r.id) }, state: 'resolved' } });
      deleted += result.count;
      if (rows.length < ALERTS_PURGE_BATCH) break;
    }
    this.logger.log(`Alert incident purge removed ${deleted} incident(s) resolved before ${cutoff.toISOString()} (job ${job.id})`);
  }
}
