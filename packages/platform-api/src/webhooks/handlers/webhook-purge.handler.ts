// =============================================================================
// `webhooks.deliveries_purge`: the delivery retention (issue #1046)
// =============================================================================
//
// Deletes delivery rows older than `deliveryRetentionDays`, oldest first, in
// batches, across every organization (the bypass client, reason `retention`).
// Queued once a day by `WebhookPurgeTask`, which only enqueues. Idempotent: a
// run that stops early leaves the rest to the next. Server-only: it deletes
// across tenants.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { WEBHOOK_PURGE_JOB_TYPE } from '../webhooks.constants';
import { WEBHOOKS_OPTIONS, type ResolvedWebhooksModuleOptions } from '../webhooks.options';
import { WebhooksRepository } from '../webhooks.repository';

/**
 * The `webhooks.deliveries_purge` job. See the file header.
 *
 * @stability experimental
 */
@Injectable()
export class WebhookPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(WebhookPurgeHandler.name);

  /** PERMANENT once jobs of this type exist. */
  readonly type = WEBHOOK_PURGE_JOB_TYPE;

  /** Its name in the jobs console. */
  readonly label = 'Webhook delivery purge';

  /** Deletes only; thirty minutes, three attempts. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 3 };

  /** Overridable clock, for tests. */
  now: () => Date = () => new Date();

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly repository: WebhooksRepository,
    @Inject(WEBHOOKS_OPTIONS) private readonly options: ResolvedWebhooksModuleOptions,
  ) {}

  /** Registers the handler with the job registry. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Runs the purge.
   *
   * @param job - the claimed job.
   */
  async process(job: Job): Promise<void> {
    const cutoff = new Date(this.now().getTime() - this.options.deliveryRetentionDays * 24 * 3_600_000);
    const deleted = await this.repository.purgeDeliveriesBefore(cutoff);
    this.logger.log(`Webhook delivery purge removed ${deleted} row(s) created before ${cutoff.toISOString()} (job ${job.id})`);
  }
}
